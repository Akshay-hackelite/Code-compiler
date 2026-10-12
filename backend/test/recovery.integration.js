const Queue = require("bull");
const Job = require("../models/Job");
const { createRedisService } = require("../jobQueue");
const { command } = require("../runner");
const os = require("node:os");
const {
  sleep,
  until,
  launchWorker,
  ready,
  done,
  stopWorker,
  writeReport,
  requireTestDatabase,
  randomUUID,
  assert,
} = require("./helpers/integration");
(async () => {
  requireTestDatabase();
  const queueName = `compileit-recovery-${randomUUID()}`;
  const mode = process.env.EXECUTION_MODE || "docker";
  const env = {
    QUEUE_NAME: queueName,
    WORKER_CONCURRENCY: "1",
    EXECUTION_MODE: mode,
    WORKER_LEASE_MS: "1200",
    WORKER_HEARTBEAT_MS: "200",
    BULL_LOCK_MS: "1000",
    BULL_STALLED_MS: "500",
  };
  const service = await createRedisService({ queueName, processJobs: false });
  const raw = new Queue(queueName, process.env.REDIS_URL);
  const workers = [];
  const checks = [];
  try {
    const payload = {
      language: "py",
      code: 'import time\ntime.sleep(2)\nprint("recovered")',
      input: "",
    };
    const submissions = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.submit(payload, { idempotencyKey: "recovery-request-001" }),
      ),
    );
    assert.equal(new Set(submissions).size, 1);
    await assert.rejects(
      service.submit(
        { ...payload, code: 'print("different")' },
        { idempotencyKey: "recovery-request-001" },
      ),
      { status: 409 },
    );
    checks.push(
      "Eight concurrent request retries create one MongoDB job; key reuse with changed payload returns 409.",
    );
    const id = submissions[0];
    const first = launchWorker(env);
    workers.push(first);
    await ready(first);
    await until(() =>
      first.events.find((event) => event.type === "claimed" && event.id === id),
    );
    // A hard kill deliberately bypasses graceful shutdown, as a host/worker crash would.
    const firstClaim = first.events.find(
      (event) => event.type === "claimed" && event.id === id,
    );
    if (mode === "docker")
      await until(
        async () => {
          const info = await command(
            [
              "docker",
              "inspect",
              "--format",
              "{{.State.Running}}",
              `compileit-${firstClaim.token}`,
            ],
            { cwd: os.tmpdir(), env: process.env },
          );
          return info.stdout.trim() === "true";
        },
        10000,
        "first attempt container running",
      );
    await sleep(300);
    await stopWorker(first, "SIGKILL");
    const second = launchWorker(env);
    workers.push(second);
    await ready(second);
    const recovered = await done(service, id, 30000);
    assert.equal(recovered.status, "success");
    assert.equal(recovered.output, "recovered\n");
    assert.equal(recovered.attemptCount, 2);
    assert.equal(recovered.resultVersion, 1);
    if (mode === "docker") {
      const old = await command(
        ["docker", "inspect", `compileit-${firstClaim.token}`],
        { cwd: os.tmpdir(), env: process.env },
      );
      assert.notEqual(
        old.exitCode,
        0,
        "Recovery must remove the orphaned first-attempt container",
      );
    }
    checks.push(
      "A SIGKILL during an active claim is recovered by a new worker; two attempts commit one result.",
    );
    // Redeliver the same DB job through a different queue entry after completion.
    await raw.add(
      { id },
      { jobId: `duplicate-${randomUUID()}`, removeOnComplete: true },
    );
    await until(() =>
      second.events.find(
        (event) => event.type === "duplicate_skipped" && event.id === id,
      ),
    );
    const replayed = await service.get(id);
    assert.equal(replayed.attemptCount, 2);
    assert.equal(replayed.resultVersion, 1);
    assert.equal(replayed.output, recovered.output);
    checks.push(
      "Duplicate queue delivery after completion does not rerun the program or rewrite its result.",
    );
    // Concurrent queue duplicates also contend on the same Mongo lease.
    const third = launchWorker(env);
    workers.push(third);
    await ready(third);
    const concurrent = await service.submit({
      language: "py",
      code: "import time\ntime.sleep(0.3)\nprint(7)",
    });
    await raw.add(
      { id: concurrent },
      { jobId: `parallel-duplicate-${randomUUID()}`, removeOnComplete: true },
    );
    const once = await done(service, concurrent);
    assert.equal(once.status, "success");
    assert.equal(once.attemptCount, 1);
    assert.equal(once.resultVersion, 1);
    checks.push(
      "Concurrent duplicate deliveries across two worker processes produce one claim and one committed result.",
    );
    // Create only the durable record to simulate a producer dying before the Redis write.
    const pending = await Job.create({
      queueName,
      language: "py",
      code: 'print("outbox recovered")',
    });
    const enqueued = await done(service, String(pending._id), 20000);
    assert.equal(enqueued.output, "outbox recovered\n");
    checks.push(
      "A pending MongoDB submission with no Redis entry is enqueued by reconciliation.",
    );
    // A worker that has lost ownership is fenced out of the final write.
    const stale = await service.submit({
      language: "py",
      code: 'import time\ntime.sleep(1)\nprint("stale")',
    });
    await until(async () => (await service.get(stale))?.status === "running");
    await Job.updateOne(
      { _id: stale },
      {
        $set: {
          status: "success",
          output: "new owner result",
          executionToken: randomUUID(),
          completedAt: new Date(),
          resultVersion: 1,
        },
      },
    );
    await until(() =>
      workers.some((worker) =>
        worker.events.find(
          (event) =>
            event.type === "stale_result_ignored" && event.id === stale,
        ),
      ),
    );
    assert.equal((await service.get(stale)).output, "new owner result");
    assert.equal((await service.get(stale)).resultVersion, 1);
    checks.push(
      "A stale worker cannot overwrite a result owned by a newer execution token.",
    );
    const cancelledId = await service.submit({
      language: "py",
      code: "import time\ntime.sleep(3)",
    });
    await until(
      async () => (await service.get(cancelledId))?.status === "running",
    );
    await service.cancel(cancelledId);
    await raw.add(
      { id: cancelledId },
      { jobId: `cancelled-replay-${randomUUID()}`, removeOnComplete: true },
    );
    await until(() =>
      workers.some((worker) =>
        worker.events.find(
          (event) =>
            event.type === "duplicate_skipped" && event.id === cancelledId,
        ),
      ),
    );
    assert.equal((await service.get(cancelledId)).status, "cancelled");
    checks.push(
      "A cancelled job remains cancelled when its queue message is redelivered.",
    );
    const draining = await service.submit({
      language: "py",
      code: 'import time\ntime.sleep(0.5)\nprint("gracefully drained")',
    });
    const owner = await until(() =>
      workers.find((worker) =>
        worker.events.find(
          (event) => event.type === "claimed" && event.id === draining,
        ),
      ),
    );
    await stopWorker(owner);
    const drained = await done(service, draining);
    assert.equal(drained.status, "success");
    assert.equal(drained.output, "gracefully drained\n");
    assert.equal(drained.attemptCount, 1);
    checks.push(
      "Graceful worker shutdown drains an active job to completion rather than cancelling it.",
    );
    const report = {
      verifiedAt: new Date().toISOString(),
      executionMode: mode,
      checks,
      deliverySemantics:
        "At least once; one accepted result per job. A crash may execute a program again. External side effects are not exactly-once.",
      testWorkerTiming: {
        leaseMs: 1200,
        heartbeatMs: 200,
        bullLockMs: 1000,
        stalledIntervalMs: 500,
      },
    };
    console.log(JSON.stringify(report, null, 2));
    console.log("Report:", await writeReport(`recovery-${mode}.json`, report));
  } finally {
    for (const worker of workers) await stopWorker(worker);
    await raw.close();
    await service.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
