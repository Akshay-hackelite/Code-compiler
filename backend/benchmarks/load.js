const os = require("node:os");
const fs = require("node:fs/promises");
const { performance } = require("node:perf_hooks");
const { createApp } = require("../index");
const { command } = require("../runner");
const { createRedisService } = require("../jobQueue");
const {
  launchWorker,
  ready,
  stopWorker,
  writeReport,
  requireTestDatabase,
  randomUUID,
  sleep,
} = require("../test/helpers/integration");
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
    : null;
}
function describe(values) {
  return {
    count: values.length,
    mean: values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  };
}
async function scenario(workerCount, executionMode, count, clients) {
  const queueName = `compileit-benchmark-${randomUUID()}`;
  const service = await createRedisService({ queueName, processJobs: false });
  const workers = [];
  let server;
  try {
    for (let i = 0; i < workerCount; i++) {
      const worker = launchWorker({
        QUEUE_NAME: queueName,
        WORKER_CONCURRENCY: "1",
        EXECUTION_MODE: executionMode,
      });
      workers.push(worker);
      await ready(worker);
    }
    server = createApp(service).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    // Each scenario uses a fresh API limiter and <=30 submissions, so production limits remain enabled.
    const requests = [];
    let next = 0;
    const started = performance.now();
    await Promise.all(
      Array.from({ length: clients }, async () => {
        while (next < count) {
          const index = next++;
          const sent = performance.now();
          try {
            const response = await fetch(`${base}/run`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": `bench-${queueName}-${index}`,
              },
              signal: AbortSignal.timeout(15000),
              body: JSON.stringify({
                language: "py",
                code: "import time\ntime.sleep(0.1)\nprint(sum(range(10000)))",
                input: "",
                testCases: [],
              }),
            });
            const data = await response.json();
            const admissionMs = performance.now() - sent;
            if (response.status !== 201) {
              requests.push({
                index,
                status: "rejected",
                httpStatus: response.status,
                admissionMs,
              });
              continue;
            }
            const deadline = performance.now() + 180000;
            let job;
            do {
              const poll = await fetch(`${base}/status?id=${data.jobId}`, {
                signal: AbortSignal.timeout(10000),
              });
              if (!poll.ok) throw new Error(`Status HTTP ${poll.status}`);
              job = (await poll.json()).job;
              if (!["pending", "running"].includes(job.status)) break;
              if (performance.now() > deadline)
                throw new Error("Completion timeout");
              await sleep(50);
            } while (true);
            requests.push({
              index,
              status: job.status,
              admissionMs,
              observedLatencyMs: performance.now() - sent,
              serverLatencyMs:
                new Date(job.completedAt) - new Date(job.submittedAt),
              queueWaitMs: job.queueWaitMs,
              executionMs: job.totalDurationMs ?? job.durationMs,
              attempts: job.attemptCount,
              outputCorrect: job.output === "49995000\n",
            });
          } catch (error) {
            requests.push({
              index,
              status: "request_error",
              error: error.message,
            });
          }
        }
      }),
    );
    const wallSeconds = (performance.now() - started) / 1000;
    const accepted = requests.filter(
      (item) => !["rejected", "request_error"].includes(item.status),
    );
    const successful = accepted.filter(
      (item) => item.status === "success" && item.outputCorrect,
    );
    return {
      workerProcesses: workerCount,
      slotsPerWorker: 1,
      clientConcurrency: clients,
      submitted: count,
      accepted: accepted.length,
      successful: successful.length,
      rejected: requests.filter((item) => item.status === "rejected").length,
      requestErrors: requests.filter((item) => item.status === "request_error")
        .length,
      failedAccepted: accepted.length - successful.length,
      failureRatePercent: accepted.length
        ? (100 * (accepted.length - successful.length)) / accepted.length
        : null,
      overallUnsuccessfulPercent: (100 * (count - successful.length)) / count,
      wallSeconds,
      successfulJobsPerSecond: successful.length / wallSeconds,
      admissionMs: describe(accepted.map((item) => item.admissionMs)),
      observedEndToEndMs: describe(
        accepted.map((item) => item.observedLatencyMs),
      ),
      serverEndToEndMs: describe(accepted.map((item) => item.serverLatencyMs)),
      queueWaitMs: describe(
        accepted.map((item) => item.queueWaitMs).filter(Number.isFinite),
      ),
      executionMs: describe(
        accepted.map((item) => item.executionMs).filter(Number.isFinite),
      ),
      requests: requests.sort((a, b) => a.index - b.index),
    };
  } finally {
    for (const worker of workers) await stopWorker(worker);
    if (server) await new Promise((resolve) => server.close(resolve));
    await service.close();
  }
}
(async () => {
  requireTestDatabase();
  const count = Number(process.env.BENCH_REQUESTS) || 30;
  const clients = Number(process.env.BENCH_CLIENTS) || 8;
  const executionMode = process.env.EXECUTION_MODE || "docker";
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 30 ||
    !Number.isInteger(clients) ||
    clients < 1 ||
    clients > 30
  )
    throw new Error(
      "Use 1–30 requests and clients to retain the production rate limit.",
    );
  const workerCounts = (process.env.BENCH_WORKERS || "1,2")
    .split(",")
    .map(Number);
  if (
    workerCounts.some(
      (value) => !Number.isInteger(value) || value < 1 || value > 8,
    )
  )
    throw new Error("Use 1–8 worker processes.");
  const scenarios = [];
  for (const workers of workerCounts) {
    console.log(
      `Benchmarking ${workers} worker process(es), ${executionMode}, ${count} requests...`,
    );
    scenarios.push(await scenario(workers, executionMode, count, clients));
  }
  let dockerEnvironment;
  if (executionMode === "docker") {
    const info = await command(["docker", "info", "--format", "{{json .}}"], {
      cwd: os.tmpdir(),
      env: process.env,
      timeout: 5000,
    });
    const image = await command(
      [
        "docker",
        "image",
        "inspect",
        process.env.RUNNER_IMAGE || "compileit-runner",
        "--format",
        "{{.Id}}",
      ],
      { cwd: os.tmpdir(), env: process.env, timeout: 5000 },
    );
    if (info.status === "success") {
      const details = JSON.parse(info.stdout);
      dockerEnvironment = {
        serverVersion: details.ServerVersion,
        operatingSystem: details.OperatingSystem,
        engineCpus: details.NCPU,
        engineMemoryGB: details.MemTotal / 1024 ** 3,
        imageId: image.stdout.trim(),
      };
    } else dockerEnvironment = { metadataError: info.stderr || info.status };
  }
  const cpu = os.cpus();
  const report = {
    measuredAt: new Date().toISOString(),
    executionMode,
    dockerEnvironment,
    workload:
      "Python: sleep 100ms, sum(range(10000)), print result; one program per job",
    environment: {
      node: process.version,
      platform: os.platform(),
      arch: os.arch(),
      cpuModel: cpu[0]?.model,
      logicalCpus: cpu.length,
      totalMemoryGB: os.totalmem() / 1024 ** 3,
    },
    methodology:
      "Closed-loop HTTP clients: each waits for completion before the next request; fresh API/queue per scenario, real Redis/MongoDB, 50ms polling, production 30/min/IP limit enabled, no warm-up. End-to-end covers admission/queue/execute/observed completion; separate server timestamps exclude polling delay. This is one local sample per worker count, not a capacity guarantee.",
    scenarios,
  };
  const file = await writeReport(`benchmark-${executionMode}.json`, report);
  console.log("Report:", file);
  for (const s of scenarios)
    console.log(
      JSON.stringify({
        workers: s.workerProcesses,
        success: `${s.successful}/${s.submitted}`,
        throughput: s.successfulJobsPerSecond,
        failureRatePercent: s.failureRatePercent,
        p95LatencyMs: s.observedEndToEndMs.p95,
        p95QueueMs: s.queueWaitMs.p95,
      }),
    );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
