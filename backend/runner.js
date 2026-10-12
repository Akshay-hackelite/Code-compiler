const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const languages = {
  cpp: {
    file: "main.cpp",
    compile: ["g++", "-std=c++17", "main.cpp", "-O2", "-o", "program"],
    run: ["./program"],
  },
  c: {
    file: "main.c",
    compile: ["gcc", "-std=c11", "main.c", "-O2", "-o", "program"],
    run: ["./program"],
  },
  py: { file: "main.py", run: ["python3", "-I", "main.py"] },
  java: {
    file: "Main.java",
    compile: ["javac", "Main.java"],
    run: [
      "java",
      "-Xmx128m",
      "-XX:CompressedClassSpaceSize=32m",
      "-XX:ReservedCodeCacheSize=32m",
      "Main",
    ],
  },
};
const OUTPUT_LIMIT = 128 * 1024;
function command(
  args,
  {
    cwd,
    input = "",
    timeout = 5000,
    signal,
    outputLimit = OUTPUT_LIMIT,
    env,
  } = {},
) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(args[0], args.slice(1), {
      cwd,
      detached: process.platform !== "win32",
      env: env || {
        PATH: process.env.PATH,
        HOME: cwd,
        TMPDIR: cwd,
        LANG: "C.UTF-8",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      bytes = 0,
      reason;
    const kill = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const cancel = () => {
      reason = "cancelled";
      kill();
    };
    const timer = setTimeout(() => {
      reason = "timeout";
      kill();
    }, timeout);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const collect = (type, chunk) => {
      const remaining = Math.max(0, outputLimit - bytes);
      bytes += chunk.length;
      if (type === "stdout") stdout += chunk.subarray(0, remaining).toString();
      else stderr += chunk.subarray(0, remaining).toString();
      if (bytes > outputLimit) {
        reason = "output_limit";
        kill();
      }
    };
    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.on("error", (error) => {
      stderr += error.message;
      reason = "error";
    });
    child.on("close", (code, terminationSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      resolve({
        stdout,
        stderr,
        exitCode: code,
        signal: terminationSignal,
        status: reason || (code === 0 ? "success" : "error"),
        durationMs: Date.now() - started,
      });
    });
  });
}
async function execute(
  { language, code, input = "", testCases = [] },
  { signal, mode = process.env.EXECUTION_MODE || "docker", containerName } = {},
) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "compileit-"));
  const config = languages[language];
  const container = containerName || `compileit-${randomUUID()}`;
  if (!/^compileit-[a-f0-9-]+$/.test(container))
    throw new Error("Invalid runner container name.");
  const started = Date.now();
  try {
    await fs.writeFile(path.join(directory, config.file), code);
    const run = async (args, stdin, timeout) => {
      if (signal?.aborted)
        return { status: "cancelled", stdout: "", stderr: "", durationMs: 0 };
      if (mode === "local")
        return command(args, { cwd: directory, input: stdin, timeout, signal });
      throw new Error(
        "Docker execution is handled as a complete isolated job.",
      );
    };
    let compiled;
    let runCase;
    if (mode === "docker") {
      // A fresh container receives source over stdin. No host directories or Docker socket are mounted.
      const payload = JSON.stringify({ language, code, input, testCases });
      const result = await command(
        [
          "docker",
          "run",
          "--rm",
          "-i",
          "--name",
          container,
          "--label",
          "com.compileit.runner=true",
          "--network",
          "none",
          "--memory",
          "384m",
          "--memory-swap",
          "384m",
          "--cpus",
          "1",
          "--pids-limit",
          "64",
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--tmpfs",
          "/work:rw,exec,nosuid,size=64m,uid=1000,gid=1000",
          "--user",
          "1000:1000",
          process.env.RUNNER_IMAGE || "compileit-runner",
        ],
        {
          cwd: directory,
          input: payload,
          timeout: 90000,
          signal,
          outputLimit: 16 * 1024 * 1024,
          env: process.env,
        },
      );
      if (result.status !== "success")
        return {
          ...result,
          output: result.stderr || result.stdout || "Execution stopped.",
        };
      try {
        return JSON.parse(result.stdout);
      } catch {
        return {
          status: "error",
          output: "Runner returned an invalid result.",
          stderr: result.stderr,
        };
      }
    }
    if (mode !== "local")
      throw new Error("EXECUTION_MODE must be docker or local.");
    if (config.compile) {
      compiled = await run(config.compile, "", 15000);
      if (compiled.status !== "success")
        return {
          ...compiled,
          output: compiled.stderr || compiled.stdout,
          phase: "compile",
        };
    }
    runCase = (stdin) => run(config.run, stdin, 5000);
    const cases = [];
    for (const [index, test] of testCases.entries()) {
      const result = await runCase(test.input);
      const normalize = (value) => value.replace(/\r\n/g, "\n").trimEnd();
      cases.push({
        ...result,
        index,
        expected: test.expected,
        passed:
          result.status === "success" &&
          normalize(result.stdout) === normalize(test.expected),
      });
      if (result.status === "cancelled") break;
    }
    const result = testCases.length
      ? {
          status: signal?.aborted
            ? "cancelled"
            : cases.every((c) => c.passed)
              ? "success"
              : "error",
          stdout: `${cases.filter((c) => c.passed).length}/${testCases.length} test cases passed.`,
          stderr: cases
            .map((c) => c.stderr)
            .filter(Boolean)
            .join("\n"),
          durationMs: Date.now() - started,
        }
      : await runCase(input);
    return {
      ...result,
      output: result.stdout,
      testResults: cases,
      compileOutput: compiled?.stderr || "",
      totalDurationMs: Date.now() - started,
    };
  } finally {
    if (mode === "docker") await cleanupContainer(container);
    await fs.rm(directory, { recursive: true, force: true });
  }
}
async function cleanupContainer(name) {
  if (!/^compileit-[a-f0-9-]+$/.test(name))
    throw new Error("Invalid runner container name.");
  return command(["docker", "rm", "-f", name], {
    cwd: os.tmpdir(),
    timeout: 5000,
    env: process.env,
  });
}
module.exports = { execute, command, languages, cleanupContainer };
