const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../index");
const { JobService } = require("../service");
test("API preserves JSON/multipart execution and handles invalid requests and cancellation", async () => {
  const service = new JobService({
    executor: async (job) => ({
      status: "success",
      output: job.input || job.code,
    }),
  });
  const server = createApp(service).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const body of [
      {},
      { code: "x", language: "shell" },
      { code: "x", testCases: [{}] },
      { code: "x", input: {} },
      { code: "x".repeat(65537) },
    ]) {
      const response = await fetch(`${url}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
    }
    const response = await fetch(`${url}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "print(42)", language: "py" }),
    });
    assert.equal(response.status, 201);
    const { jobId } = await response.json();
    await new Promise((resolve) => setImmediate(resolve));
    const result = await (await fetch(`${url}/status?id=${jobId}`)).json();
    assert.equal(result.job.output, "print(42)");
    assert.equal(result.job.code, undefined);
    assert.equal((await fetch(`${url}/status`)).status, 400);
    assert.equal((await fetch(`${url}/status?id=missing`)).status, 404);
    assert.equal(
      (await fetch(`${url}/jobs/missing`, { method: "DELETE" })).status,
      404,
    );
    const form = new FormData();
    form.set("language", "c");
    form.set("codeFile", new Blob(["source"]), "main.c");
    form.set("inputFile", new Blob(["input data"]), "input.txt");
    const uploaded = await (
      await fetch(`${url}/run`, { method: "POST", body: form })
    ).json();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      (await (await fetch(`${url}/status?id=${uploaded.jobId}`)).json()).job
        .output,
      "input data",
    );
    const huge = new FormData();
    huge.set("codeFile", new Blob(["a".repeat(65537)]), "main.c");
    assert.equal(
      (await fetch(`${url}/run`, { method: "POST", body: huge })).status,
      400,
    );
    assert.equal((await (await fetch(`${url}/health`)).json()).status, "ok");
    for (let i = 0; i < 22; i++)
      await fetch(`${url}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    const limited = await fetch(`${url}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get("retry-after"));
  } finally {
    await service.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("API idempotency keys return one job for retries and reject conflicting requests", async () => {
  const service = new JobService({
    executor: async () => ({ status: "success", output: "42" }),
  });
  const server = createApp(service).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (code) =>
    fetch(`${url}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "api-request-001",
      },
      body: JSON.stringify({ language: "py", code }),
    });
  try {
    const responses = await Promise.all([post("print(42)"), post("print(42)")]);
    assert.ok(responses.every((response) => response.status === 201));
    const jobs = await Promise.all(
      responses.map((response) => response.json()),
    );
    assert.equal(jobs[0].jobId, jobs[1].jobId);
    assert.equal((await post("print(43)")).status, 409);
  } finally {
    await service.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
