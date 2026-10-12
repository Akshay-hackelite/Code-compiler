const { execute, command } = require("../runner");
const os = require("node:os");
const {
  randomUUID,
  assert,
  until,
  writeReport,
} = require("./helpers/integration");
(async () => {
  const checks = [];
  const inspect = async (name) => {
    const result = await command(["docker", "inspect", name], {
      cwd: os.tmpdir(),
      env: process.env,
    });
    return result.exitCode === 0 ? JSON.parse(result.stdout)[0] : null;
  };
  const sources = {
    cpp: '#include <iostream>\nint main(){std::cout << "42";}',
    c: '#include <stdio.h>\nint main(){printf("42");}',
    py: "print(42)",
    java: "public class Main { public static void main(String[] args) { System.out.println(42); } }",
  };
  for (const [language, code] of Object.entries(sources)) {
    const result = await execute(
      { language, code, testCases: [{ input: "", expected: "42" }] },
      { mode: "docker" },
    );
    assert.equal(
      result.status,
      "success",
      `${language}: ${JSON.stringify(result)}`,
    );
    assert.equal(result.testResults[0].passed, true);
    checks.push(
      `${language}: isolated compilation/execution and test comparison passed.`,
    );
  }
  const isolation = await execute(
    {
      language: "py",
      code: 'import os,socket\nprint(os.getuid())\ntry:\n open("/opt/forbidden", "w")\n print("writable")\nexcept OSError:\n print("read-only")\ns=socket.socket()\ns.settimeout(1)\ntry:\n s.connect(("1.1.1.1",80))\n print("network enabled")\nexcept OSError:\n print("network disabled")\nprint(os.path.exists("/var/run/docker.sock"))\nopen("scratch.txt","w").write("ok")\nprint(open("scratch.txt").read())',
    },
    { mode: "docker" },
  );
  assert.equal(
    isolation.output,
    "1000\nread-only\nnetwork disabled\nFalse\nok\n",
  );
  checks.push(
    "Non-root user, read-only root filesystem, disabled network, no Docker socket, and writable temporary workspace verified.",
  );
  const name = `compileit-${randomUUID()}`;
  const controller = new AbortController();
  const running = execute(
    { language: "py", code: "import time\ntime.sleep(4)" },
    { mode: "docker", containerName: name, signal: controller.signal },
  );
  const details = await until(
    async () => {
      const state = await inspect(name);
      return state?.State.Running ? state : null;
    },
    10000,
    "live runner container",
  );
  assert.equal(details.HostConfig.Memory, 384 * 1024 * 1024);
  assert.equal(details.HostConfig.MemorySwap, details.HostConfig.Memory);
  assert.equal(details.HostConfig.NanoCpus, 1e9);
  assert.equal(details.HostConfig.PidsLimit, 64);
  assert.equal(details.HostConfig.ReadonlyRootfs, true);
  assert.equal(details.HostConfig.NetworkMode, "none");
  assert.deepEqual(details.HostConfig.CapDrop, ["ALL"]);
  assert.ok(details.HostConfig.SecurityOpt.includes("no-new-privileges"));
  assert.ok(details.Mounts.every((mount) => mount.Type === "tmpfs"));
  assert.equal((details.HostConfig.Binds || []).length, 0);
  controller.abort();
  const cancelled = await running;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(await inspect(name), null);
  checks.push(
    "Active cancellation removes its container; CPU/memory/PID/capability limits and absence of host mounts inspected on a live run.",
  );
  const timedName = `compileit-${randomUUID()}`;
  const timeout = await execute(
    { language: "py", code: "while True: pass" },
    { mode: "docker", containerName: timedName },
  );
  assert.equal(timeout.status, "timeout");
  assert.equal(await inspect(timedName), null);
  checks.push(
    "An infinite loop hits the five-second deadline and its container is removed.",
  );
  const flood = await execute(
    { language: "py", code: 'import sys\nsys.stdout.write("x"*300000)' },
    { mode: "docker" },
  );
  assert.equal(flood.status, "output_limit");
  assert.ok(Buffer.byteLength(flood.stdout) <= 131072);
  checks.push("Output flooding is stopped at 128 KB.");
  const disk = await execute(
    {
      language: "py",
      code: 'import os\ntry:\n f=open("large.bin","wb")\n for _ in range(100): f.write(b"x"*1048576)\n f.close()\n print("unbounded")\nexcept OSError as e:\n print("limited",e.errno)',
    },
    { mode: "docker" },
  );
  assert.equal(disk.status, "success");
  assert.equal(disk.output, "limited 28\n");
  checks.push("Temporary disk writes are constrained by the 64 MB tmpfs.");
  const memory = await execute(
    {
      language: "py",
      code: "items=[]\nwhile True: items.append(bytearray(16*1024*1024))",
    },
    { mode: "docker" },
  );
  assert.equal(
    memory.status,
    "error",
    "Memory pressure must fail independently of the execution deadline",
  );
  assert.ok(
    memory.exitCode === 137 ||
      memory.signal === "SIGKILL" ||
      /MemoryError|Killed/.test(memory.stderr || ""),
    JSON.stringify(memory),
  );
  checks.push("Unbounded memory allocation is terminated by the memory limit.");
  const processes = await execute(
    {
      language: "py",
      code: 'import subprocess\nchildren=[]\ntry:\n for _ in range(80): children.append(subprocess.Popen(["python3","-c","import time;time.sleep(2)"]))\n print("unbounded")\nexcept OSError as e:\n print("limited",e.errno)\nfinally:\n for child in children: child.terminate()\n for child in children: child.wait()',
    },
    { mode: "docker" },
  );
  assert.equal(processes.status, "success");
  assert.equal(processes.output, "limited 11\n");
  checks.push("Process fan-out reaches the 64-process cap and is rejected.");
  const report = {
    verifiedAt: new Date().toISOString(),
    image: process.env.RUNNER_IMAGE || "compileit-runner",
    checks,
    limits: {
      memoryMB: 384,
      cpus: 1,
      pids: 64,
      tmpfsMB: 64,
      executionDeadlineMs: 5000,
      outputKB: 128,
    },
    notes:
      "These tests verify the configured boundaries; they are not a security audit or a proof against container escape.",
  };
  console.log(JSON.stringify(report, null, 2));
  console.log("Report:", await writeReport("docker.json", report));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
