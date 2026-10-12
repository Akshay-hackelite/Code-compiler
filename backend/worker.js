const { createRedisService } = require("./jobQueue");
(async () => {
  const service = await createRedisService({
    concurrency: Math.max(
      1,
      Math.min(8, Number(process.env.WORKER_CONCURRENCY) || 2),
    ),
    leaseMs: Number(process.env.WORKER_LEASE_MS) || 12000,
    heartbeatMs: Number(process.env.WORKER_HEARTBEAT_MS) || 1000,
    settings: {
      lockDuration: Number(process.env.BULL_LOCK_MS) || 30000,
      stalledInterval: Number(process.env.BULL_STALLED_MS) || 30000,
    },
    onEvent: (event) => {
      if (process.connected) process.send(event);
      if (process.env.WORKER_LOG_EVENTS === "true")
        console.log(JSON.stringify(event));
    },
  });
  if (process.connected) process.send({ type: "ready" });
  console.log("CompileIt worker ready.");
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await service.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  if (process.send) process.once("disconnect", stop);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
