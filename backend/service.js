const { randomUUID } = require("node:crypto");
const { validateKey, payloadDigest, verifyReplay } = require("./submission");
const { execute } = require("./runner");
const TERMINAL = new Set([
  "success",
  "error",
  "timeout",
  "cancelled",
  "output_limit",
]);
class JobService {
  constructor({
    executor = execute,
    concurrency = 2,
    maxPending = 50,
    retention = 24 * 60 * 60 * 1000,
  } = {}) {
    this.executor = executor;
    this.concurrency = concurrency;
    this.maxPending = maxPending;
    this.retention = retention;
    this.jobs = new Map();
    this.waiting = [];
    this.running = new Map();
    this.completed = 0;
    this.failed = 0;
    this.closed = false;
    this.sweeper = setInterval(() => this.prune(), 60000);
    this.sweeper.unref();
  }
  prune() {
    for (const [id, job] of this.jobs)
      if (
        job.completedAt &&
        Date.now() - new Date(job.completedAt) > this.retention
      )
        this.jobs.delete(id);
    const completed = [...this.jobs.values()].filter((job) => job.completedAt);
    for (const job of completed.slice(0, Math.max(0, completed.length - 100)))
      this.jobs.delete(job._id);
  }
  async submit(payload, { idempotencyKey } = {}) {
    this.prune();
    validateKey(idempotencyKey);
    const digest = payloadDigest(payload);
    if (idempotencyKey) {
      const existing = [...this.jobs.values()].find(
        (job) => job.idempotencyKey === idempotencyKey,
      );
      if (existing) return verifyReplay(existing, digest);
    }
    if (this.closed || this.waiting.length >= this.maxPending)
      throw Object.assign(
        new Error("The execution queue is full. Try again shortly."),
        { status: 503 },
      );
    const job = {
      ...payload,
      idempotencyKey,
      payloadHash: digest,
      _id: randomUUID(),
      status: "pending",
      submittedAt: new Date().toISOString(),
    };
    this.jobs.set(job._id, job);
    this.waiting.push(job._id);
    this.drain();
    return job._id;
  }
  async get(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    const {
      code,
      input,
      testCases,
      idempotencyKey,
      payloadHash,
      ...publicJob
    } = job;
    return {
      ...publicJob,
      queuePosition: Math.max(0, this.waiting.indexOf(id) + 1),
    };
  }
  drain() {
    while (
      !this.closed &&
      this.running.size < this.concurrency &&
      this.waiting.length
    ) {
      const id = this.waiting.shift();
      const job = this.jobs.get(id);
      const controller = new AbortController();
      this.running.set(id, controller);
      job.status = "running";
      job.startedAt = new Date().toISOString();
      Promise.resolve()
        .then(() => this.executor(job, { signal: controller.signal }))
        .then((result) => Object.assign(job, result))
        .catch((error) =>
          Object.assign(job, { status: "error", output: error.message }),
        )
        .finally(() => {
          if (controller.signal.aborted) job.status = "cancelled";
          job.completedAt = new Date().toISOString();
          job.queueWaitMs = new Date(job.startedAt) - new Date(job.submittedAt);
          if (job.status === "success") this.completed++;
          else this.failed++;
          delete job.code;
          delete job.input;
          delete job.testCases;
          this.prune();
          this.running.delete(id);
          this.drain();
        });
    }
  }
  async cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (!TERMINAL.has(job.status)) {
      const index = this.waiting.indexOf(id);
      if (index >= 0) this.waiting.splice(index, 1);
      this.running.get(id)?.abort();
      job.status = "cancelled";
      job.completedAt = new Date().toISOString();
    }
    return this.get(id);
  }
  async stats() {
    return {
      mode: "memory",
      waiting: this.waiting.length,
      active: this.running.size,
      completed: this.completed,
      failed: this.failed,
      concurrency: this.concurrency,
    };
  }
  async close() {
    this.closed = true;
    clearInterval(this.sweeper);
    for (const controller of this.running.values()) controller.abort();
  }
}
module.exports = { JobService, TERMINAL };
