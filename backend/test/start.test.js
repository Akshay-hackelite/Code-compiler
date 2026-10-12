const test = require("node:test");
const assert = require("node:assert/strict");
const { ensureImage } = require("../scripts/start");

test("Docker startup reuses an existing image without building", () => {
  const calls = [];
  ensureImage(
    "custom-runner",
    (command, args) => {
      calls.push([command, args]);
      return { status: 0 };
    },
    () => {},
  );
  assert.deepEqual(calls, [
    ["docker", ["info"]],
    ["docker", ["image", "inspect", "custom-runner"]],
  ]);
});

test("Docker startup builds a missing image with the configured tag and backend context", () => {
  const calls = [];
  ensureImage(
    "custom-runner",
    (command, args, options) => {
      calls.push({ args, options });
      return { status: args[0] === "image" ? 1 : 0 };
    },
    () => {},
  );
  assert.deepEqual(calls[2].args, [
    "build",
    "-t",
    "custom-runner",
    "-f",
    "runner/Dockerfile",
    ".",
  ]);
  assert.equal(
    calls[2].options.cwd,
    require("node:path").resolve(__dirname, ".."),
  );
});

test("Docker startup fails clearly when the engine or image build fails", () => {
  assert.throws(
    () => ensureImage("runner", () => ({ error: new Error("ENOENT") })),
    /Docker is unavailable/,
  );
  assert.throws(
    () =>
      ensureImage(
        "runner",
        (_, args) => ({ status: args[0] === "info" ? 0 : 1 }),
        () => {},
      ),
    /build failed/,
  );
});
