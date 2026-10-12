const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JobService } = require("../service");
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("FIFO queue respects concurrency, reports position, and advances after completion", async () => {
  const releases = [];
  const started = [];
  const service = new JobService({
    concurrency: 1,
    executor: (job) =>
      new Promise((resolve) => {
        started.push(job.code);
        releases.push(resolve);
      }),
  });
  try {
    const first = await service.submit({ code: "first" });
    const second = await service.submit({ code: "second" });
    await tick();
    assert.equal((await service.get(first)).status, "running");
    assert.equal((await service.get(second)).queuePosition, 1);
    assert.deepEqual(started, ["first"]);
    assert.equal((await service.get(first)).code, undefined);
    releases.shift()({ status: "success", output: "ok" });
    await tick();
    assert.deepEqual(started, ["first", "second"]);
    assert.equal((await service.get(first)).status, "success");
    releases.shift()({ status: "success" });
    await tick();
    assert.equal((await service.stats()).completed, 2);
  } finally {
    await service.close();
  }
});
test("cancellation removes waiting jobs and aborts active execution", async () => {
  const service = new JobService({
    concurrency: 1,
    executor: (job, { signal }) =>
      new Promise((resolve) =>
        signal.addEventListener("abort", () =>
          resolve({ status: "cancelled" }),
        ),
      ),
  });
  try {
    const first = await service.submit({ code: "first" });
    const second = await service.submit({ code: "second" });
    await tick();
    assert.equal((await service.cancel(second)).status, "cancelled");
    assert.equal((await service.stats()).waiting, 0);
    await service.cancel(first);
    await tick();
    assert.equal((await service.get(first)).status, "cancelled");
    assert.equal((await service.stats()).active, 0);
  } finally {
    await service.close();
  }
});
test("queue backpressure rejects excess work and executor failures free the worker", async () => {
  let release;
  const service = new JobService({
    concurrency: 1,
    maxPending: 1,
    executor: () =>
      new Promise((resolve, reject) => {
        release = reject;
      }),
  });
  try {
    const first = await service.submit({ code: "one" });
    await service.submit({ code: "two" });
    await assert.rejects(service.submit({ code: "three" }), { status: 503 });
    await tick();
    release(new Error("compiler unavailable"));
    await tick();
    assert.equal((await service.get(first)).status, "error");
    assert.equal((await service.get(first)).output, "compiler unavailable");
    release(new Error("done"));
    await tick();
  } finally {
    await service.close();
  }
});

test("concurrent keyed retries share one job and changed payloads are rejected", async () => {
  let calls = 0;
  const service = new JobService({
    executor: async () => {
      calls++;
      return { status: "success", output: "42" };
    },
  });
  try {
    const payload = { language: "py", code: "print(42)", input: "" };
    const ids = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.submit(payload, { idempotencyKey: "test-request-001" }),
      ),
    );
    assert.equal(new Set(ids).size, 1);
    await tick();
    assert.equal(calls, 1);
    await assert.rejects(
      service.submit(
        { ...payload, code: "print(43)" },
        { idempotencyKey: "test-request-001" },
      ),
      { status: 409 },
    );
    await assert.rejects(service.submit(payload, { idempotencyKey: "bad" }), {
      status: 400,
    });
    assert.equal((await service.get(ids[0])).idempotencyKey, undefined);
  } finally {
    await service.close();
  }
});
