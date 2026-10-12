const path = require("node:path");
const { spawnSync } = require("node:child_process");

function ensureImage(image, run = spawnSync, log = console.log) {
  const options = { cwd: path.resolve(__dirname, ".."), stdio: "pipe" };
  const engine = run("docker", ["info"], options);
  if (engine.error || engine.status !== 0) {
    throw new Error(
      "Docker is unavailable. Install/start your Docker engine, then retry npm run start:docker.",
    );
  }
  const existing = run("docker", ["image", "inspect", image], options);
  if (existing.error) throw existing.error;
  if (existing.status === 0) {
    log(`Using existing runner image: ${image}`);
    return;
  }
  log(`Runner image ${image} is missing. Building it now…`);
  const build = run(
    "docker",
    ["build", "-t", image, "-f", "runner/Dockerfile", "."],
    {
      ...options,
      stdio: "inherit",
    },
  );
  if (build.error || build.status !== 0) {
    throw new Error("Runner image build failed. Backend was not started.");
  }
}

async function main() {
  const mode = process.argv[2];
  if (!["local", "docker"].includes(mode))
    throw new Error("Choose local or docker execution.");
  process.env.EXECUTION_MODE = mode;
  if (mode === "docker")
    ensureImage(process.env.RUNNER_IMAGE || "compileit-runner");
  await require("../index").start();
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

module.exports = { ensureImage };
