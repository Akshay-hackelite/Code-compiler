const { test } = require("node:test");
const assert = require("node:assert/strict");
const { command, execute } = require("../runner");
const os = require("node:os");
test("process timeout, cancellation, and output limits terminate execution", async () => {
  const timeout = await command(
    [process.execPath, "-e", "setInterval(()=>{},1000)"],
    { cwd: os.tmpdir(), timeout: 80 },
  );
  assert.equal(timeout.status, "timeout");
  const output = await command(
    [process.execPath, "-e", 'process.stdout.write("x".repeat(200000))'],
    { cwd: os.tmpdir() },
  );
  assert.equal(output.status, "output_limit");
  assert.ok(output.stdout.length <= 131072);
  const controller = new AbortController();
  const result = command([process.execPath, "-e", "setInterval(()=>{},1000)"], {
    cwd: os.tmpdir(),
    signal: controller.signal,
  });
  controller.abort();
  assert.equal((await result).status, "cancelled");
});
test("stderr alone does not turn a successful program into an error", async () => {
  const result = await command(
    [process.execPath, "-e", 'console.error("warning");console.log("ok")'],
    { cwd: os.tmpdir() },
  );
  assert.equal(result.status, "success");
  assert.equal(result.stdout, "ok\n");
  assert.equal(result.stderr, "warning\n");
});
test("Python executes stdin, compares tests, and reports syntax errors", async () => {
  const source = "a,b=map(int,input().split())\nprint(a+b)";
  const result = await execute(
    {
      language: "py",
      code: source,
      testCases: [
        { input: "12 30", expected: "42" },
        { input: "2 3", expected: "6" },
      ],
    },
    { mode: "local" },
  );
  assert.equal(result.status, "error");
  assert.equal(result.testResults[0].passed, true);
  assert.equal(result.testResults[1].passed, false);
  const bad = await execute(
    { language: "py", code: "this is invalid python!" },
    { mode: "local" },
  );
  assert.equal(bad.status, "error");
  assert.match(bad.stderr, /SyntaxError/);
});
