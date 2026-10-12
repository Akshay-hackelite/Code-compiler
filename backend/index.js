const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { JobService } = require("./service");
const { languages } = require("./runner");
const MAX_SIZE = 64 * 1024;
function validate(body) {
  const language = body.language || "cpp";
  if (!Object.hasOwn(languages, language))
    throw Object.assign(new Error("Choose C, C++, Python, or Java."), {
      status: 400,
    });
  if (typeof body.code !== "string" || !body.code.trim())
    throw Object.assign(new Error("Source code is required."), { status: 400 });
  if (
    Buffer.byteLength(body.code) > MAX_SIZE ||
    (body.input !== undefined &&
      (typeof body.input !== "string" ||
        Buffer.byteLength(body.input) > MAX_SIZE))
  )
    throw Object.assign(
      new Error("Code and input must each be text under 64 KB."),
      { status: 400 },
    );
  const testCases = body.testCases || [];
  if (
    !Array.isArray(testCases) ||
    testCases.length > 10 ||
    testCases.some(
      (test) =>
        !test ||
        typeof test.input !== "string" ||
        typeof test.expected !== "string" ||
        Buffer.byteLength(test.input) > MAX_SIZE ||
        Buffer.byteLength(test.expected) > MAX_SIZE,
    )
  )
    throw Object.assign(
      new Error(
        "Provide at most 10 test cases with text input and expected output under 64 KB.",
      ),
      { status: 400 },
    );
  return { language, code: body.code, input: body.input || "", testCases };
}
function createApp(service) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    cors({
      origin: (process.env.CLIENT_ORIGIN || "http://localhost:3000").split(","),
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SIZE, files: 2, fields: 5 },
  });
  const clients = new Map();
  const limiter = (req, res, next) => {
    const now = Date.now();
    for (const [key, item] of clients)
      if (item.reset <= now) clients.delete(key);
    const record = clients.get(req.ip) || { count: 0, reset: now + 60000 };
    record.count++;
    clients.set(req.ip, record);
    if (record.count > 30) {
      res.set("Retry-After", Math.ceil((record.reset - now) / 1000));
      return res
        .status(429)
        .json({ error: "Too many runs. Please wait a minute." });
    }
    next();
  };
  const route = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res)).catch(next);
  app.get(
    "/health",
    route(async (req, res) =>
      res.json({
        status: "ok",
        executionMode: process.env.EXECUTION_MODE || "docker",
        queue: await service.stats(),
      }),
    ),
  );
  app.get(
    "/queue",
    route(async (req, res) => res.json(await service.stats())),
  );
  app.post(
    "/run",
    limiter,
    upload.fields([
      { name: "codeFile", maxCount: 1 },
      { name: "inputFile", maxCount: 1 },
    ]),
    route(async (req, res) => {
      const body = { ...req.body };
      if (req.files?.codeFile)
        body.code = req.files.codeFile[0].buffer.toString("utf8");
      if (req.files?.inputFile)
        body.input = req.files.inputFile[0].buffer.toString("utf8");
      if (typeof body.testCases === "string") {
        try {
          body.testCases = JSON.parse(body.testCases);
        } catch {
          return res.status(400).json({ error: "Invalid test cases JSON." });
        }
      }
      const jobId = await service.submit(validate(body), {
        idempotencyKey: req.get("Idempotency-Key"),
      });
      res.status(201).json({ jobId });
    }),
  );
  app.get(
    "/status",
    route(async (req, res) => {
      if (typeof req.query.id !== "string")
        return res
          .status(400)
          .json({ success: false, error: "Missing job id." });
      const job = await service.get(req.query.id);
      if (!job)
        return res
          .status(404)
          .json({ success: false, error: "Job not found or expired." });
      res.json({ success: true, job });
    }),
  );
  app.delete(
    "/jobs/:id",
    route(async (req, res) => {
      const job = await service.cancel(req.params.id);
      if (!job)
        return res.status(404).json({ error: "Job not found or expired." });
      res.json({ success: true, job });
    }),
  );
  app.use((error, req, res, next) => {
    const status =
      error instanceof multer.MulterError ? 400 : error.status || 500;
    if (status >= 500) console.error(error.message);
    res.status(status).json({
      error:
        status === 500
          ? "Execution service unavailable. Please retry."
          : error.message,
    });
  });
  return app;
}
async function start() {
  const concurrency = Math.max(
    1,
    Math.min(8, Number(process.env.WORKER_CONCURRENCY) || 2),
  );
  const service =
    process.env.QUEUE_MODE === "redis"
      ? await require("./jobQueue").createRedisService({
          concurrency,
          processJobs: process.env.PROCESS_JOBS !== "false",
        })
      : new JobService({ concurrency });
  const server = createApp(service).listen(
    Number(process.env.PORT) || 5001,
    process.env.HOST || "127.0.0.1",
    () =>
      console.log(
        `CompileIt API: http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 5001} (${process.env.QUEUE_MODE || "memory"} queue, ${process.env.EXECUTION_MODE || "docker"} execution)`,
      ),
  );
  const stop = async () => {
    server.close();
    await service.close();
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
if (require.main === module)
  start().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
module.exports = { createApp, validate, start };
