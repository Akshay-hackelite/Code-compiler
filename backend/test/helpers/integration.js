const { fork } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function requireTestDatabase() {
  const uri = process.env.MONGODB_URI;
  const database = uri && new URL(uri).pathname.slice(1);
  if (!database || !/(test|benchmark)/i.test(database))
    throw new Error(
      "Set MONGODB_URI to a dedicated database with test or benchmark in its name.",
    );
}
function launchWorker(env = {}) {
  const child = fork(path.join(__dirname, "../../worker.js"), {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const events = [];
  let log = "";
  child.on("message", (event) => events.push(event));
  child.stdout.on("data", (chunk) => {
    log += chunk;
  });
  child.stderr.on("data", (chunk) => {
    log += chunk;
  });
  return {
    child,
    events,
    get log() {
      return log;
    },
  };
}
async function until(fn, timeout = 20000, label = "condition") {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function ready(worker) {
  return until(
    () => {
      if (worker.child.exitCode !== null) throw new Error(worker.log);
      return worker.events.find((event) => event.type === "ready");
    },
    20000,
    "worker ready",
  );
}
async function done(service, id, timeout = 20000) {
  return until(
    async () => {
      const job = await service.get(id);
      return job && !["pending", "running"].includes(job.status) ? job : false;
    },
    timeout,
    `job ${id}`,
  );
}
async function stopWorker(worker, signal = "SIGTERM") {
  if (
    !worker ||
    worker.child.exitCode !== null ||
    worker.child.signalCode !== null
  )
    return;
  const exited = new Promise((resolve) => worker.child.once("exit", resolve));
  worker.child.kill(signal);
  const timer = setTimeout(() => worker.child.kill("SIGKILL"), 10000);
  await exited;
  clearTimeout(timer);
}
async function writeReport(file, data) {
  const target = path.resolve(__dirname, "../../../docs/verification", file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(data, null, 2) + "\n");
  return target;
}
module.exports = {
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
};
