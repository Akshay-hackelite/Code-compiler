const Queue = require("bull");
const mongoose = require("mongoose");
const { randomUUID } = require("node:crypto");
const Job = require("./models/Job");
const { execute, cleanupContainer } = require("./runner");
const { TERMINAL } = require("./service");
const { validateKey, payloadDigest, verifyReplay } = require("./submission");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function createRedisService({
  concurrency = 2,
  maxPending = 50,
  processJobs = true,
  queueName = process.env.QUEUE_NAME || "compileit-v2",
  executor = execute,
  leaseMs = 12000,
  heartbeatMs = 1000,
  settings = {},
  onEvent = () => {},
} = {}) {
  if (heartbeatMs * 2 >= leaseMs)
    throw new Error("Lease duration must exceed twice the heartbeat interval.");
  await mongoose.connect(
    process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/compilerdb",
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      useFindAndModify: false,
      useCreateIndex: true,
      serverSelectionTimeoutMS: 5000,
    },
  );
  await Job.init(); // The unique index must exist before accepting retried requests.
  const queue = new Queue(
    queueName,
    process.env.REDIS_URL || "redis://127.0.0.1:6379",
    {
      settings: { maxStalledCount: 2, ...settings },
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 100,
        attempts: 3,
        backoff: { type: "exponential", delay: 500 },
      },
    },
  );
  let closed = false;
  const active = new Map();
  queue.on("error", (error) => console.error("Queue:", error.message));
  queue.on("stalled", (job) => onEvent({ type: "stalled", id: job.data.id }));
  await queue.isReady();
  const scope = (id) => ({ _id: id, queueName });
  async function ensureEnqueued(job) {
    if (!TERMINAL.has(job.status))
      await queue.add({ id: String(job._id) }, { jobId: String(job._id) });
  }
  // Recover the Mongo insert -> Redis enqueue gap if an API process died between those writes.
  let reconciling = false;
  const reconcile = async () => {
    if (closed || reconciling) return;
    reconciling = true;
    try {
      const pending = await Job.find({ queueName, status: "pending" })
        .sort({ submittedAt: 1 })
        .limit(maxPending)
        .lean();
      for (const job of pending) await ensureEnqueued(job);
    } catch (error) {
      onEvent({ type: "reconcile_error", message: error.message });
    } finally {
      reconciling = false;
    }
  };
  await reconcile();
  const reconciler = setInterval(reconcile, 5000);
  reconciler.unref();
  if (processJobs)
    queue.process(concurrency, async ({ data }) => {
      const token = randomUUID();
      let job, startedAt;
      // Bull uses at-least-once delivery. Mongo's lease allows only one current result writer.
      while (true) {
        startedAt = new Date();
        job = await Job.findOneAndUpdate(
          {
            ...scope(data.id),
            status: { $in: ["pending", "running"] },
            $or: [
              { leaseExpiresAt: { $exists: false } },
              { leaseExpiresAt: { $lte: new Date() } },
            ],
          },
          {
            $set: {
              status: "running",
              startedAt,
              leaseExpiresAt: new Date(Date.now() + leaseMs),
              executionToken: token,
            },
            $inc: { attemptCount: 1 },
          },
          { new: false },
        );
        if (job) break;
        const current = await Job.findOne(scope(data.id)).lean();
        if (!current || TERMINAL.has(current.status)) {
          onEvent({ type: "duplicate_skipped", id: data.id });
          return;
        }
        await sleep(Math.min(heartbeatMs, 250));
      }
      if (!job) return;
      const controller = new AbortController();
      active.set(token, controller);
      const owned = {
        ...scope(data.id),
        status: "running",
        executionToken: token,
      };
      let heartbeatBusy = false;
      const heartbeat = async () => {
        if (heartbeatBusy) return;
        heartbeatBusy = true;
        try {
          const updated = await Job.updateOne(owned, {
            $set: { leaseExpiresAt: new Date(Date.now() + leaseMs) },
          });
          if (!updated.n) controller.abort();
        } catch {
          controller.abort();
        } finally {
          heartbeatBusy = false;
        }
      };
      const watcher = setInterval(heartbeat, heartbeatMs);
      try {
        // The previous worker may have died with a container still running. Its name is persisted.
        if (
          job.executionToken &&
          (process.env.EXECUTION_MODE || "docker") === "docker"
        )
          await cleanupContainer(`compileit-${job.executionToken}`);
        onEvent({
          type: "claimed",
          id: data.id,
          attempt: (job.attemptCount || 0) + 1,
          token,
        });
        const result = await executor(job.toObject(), {
          signal: controller.signal,
          containerName: `compileit-${token}`,
        });
        const committed = await Job.updateOne(owned, {
          $set: {
            ...result,
            completedAt: new Date(),
            queueWaitMs: startedAt - new Date(job.submittedAt),
          },
          $unset: { leaseExpiresAt: 1 },
          $inc: { resultVersion: 1 },
        });
        onEvent({
          type: committed.n ? "completed" : "stale_result_ignored",
          id: data.id,
        });
      } catch (error) {
        // Database failures must reach Bull, not silently acknowledge a lost result.
        await Job.updateOne(owned, {
          $set: {
            status: "error",
            output: error.message,
            completedAt: new Date(),
          },
          $unset: { leaseExpiresAt: 1 },
          $inc: { resultVersion: 1 },
        });
      } finally {
        clearInterval(watcher);
        active.delete(token);
      }
    });
  queue.on("failed", (job) => {
    if (job)
      Job.updateOne(
        {
          ...scope(job.data.id),
          $or: [
            { status: "pending" },
            { status: "running", leaseExpiresAt: { $lte: new Date() } },
          ],
        },
        {
          $set: {
            status: "error",
            output: job.failedReason,
            completedAt: new Date(),
          },
          $unset: { leaseExpiresAt: 1 },
        },
      ).catch(console.error);
  });
  return {
    async submit(payload, { idempotencyKey } = {}) {
      validateKey(idempotencyKey);
      const digest = payloadDigest(payload);
      if (idempotencyKey) {
        const existing = await Job.findOne({ queueName, idempotencyKey });
        if (existing) {
          const id = verifyReplay(existing, digest);
          await ensureEnqueued(existing);
          return id;
        }
      }
      if ((await queue.getWaitingCount()) >= maxPending)
        throw Object.assign(
          new Error("The execution queue is full. Try again shortly."),
          { status: 503 },
        );
      let job;
      try {
        job = await Job.create({
          ...payload,
          queueName,
          payloadHash: digest,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        });
      } catch (error) {
        if (error.code !== 11000 || !idempotencyKey) throw error;
        job = await Job.findOne({ queueName, idempotencyKey });
        verifyReplay(job, digest);
      }
      // Keep the pending record if Redis fails; reconciliation / a keyed retry can enqueue it.
      await ensureEnqueued(job);
      return String(job._id);
    },
    async get(id) {
      if (!mongoose.isValidObjectId(id)) return null;
      const job = await Job.findOne(scope(id))
        .select(
          "-code -input -testCases -filepath -inputFilePath -executionToken -leaseExpiresAt -payloadHash -idempotencyKey -queueName",
        )
        .lean();
      if (!job) return null;
      const waiting =
        job.status === "pending" ? await queue.getWaiting(0, maxPending) : [];
      return {
        ...job,
        queuePosition: Math.max(
          0,
          waiting.findIndex((item) => item.data.id === id) + 1,
        ),
      };
    },
    async cancel(id) {
      if (!mongoose.isValidObjectId(id)) return null;
      const old = await Job.findOneAndUpdate(
        { ...scope(id), status: { $nin: [...TERMINAL] } },
        {
          $set: { status: "cancelled", completedAt: new Date() },
          $unset: { leaseExpiresAt: 1 },
        },
      );
      if (
        old?.executionToken &&
        (process.env.EXECUTION_MODE || "docker") === "docker"
      )
        await cleanupContainer(`compileit-${old.executionToken}`);
      const queued = await queue.getJob(id);
      if (queued && (await queued.getState()) === "waiting")
        await queued.remove().catch(() => {});
      return this.get(id);
    },
    async stats() {
      const counts = await queue.getJobCounts();
      return {
        mode: "redis",
        ...counts,
        completed: await Job.countDocuments({ queueName, status: "success" }),
        failed: await Job.countDocuments({
          queueName,
          status: { $in: ["error", "timeout", "output_limit"] },
        }),
        concurrency,
      };
    },
    async close() {
      closed = true;
      clearInterval(reconciler);
      // Bull pauses this worker and drains its active jobs before disconnecting.
      await queue.close();
      await mongoose.disconnect();
    },
  };
}
module.exports = { createRedisService };
