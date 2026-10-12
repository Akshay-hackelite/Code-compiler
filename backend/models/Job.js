const mongoose = require("mongoose");
const JobSchema = new mongoose.Schema({
  language: { type: String, required: true, enum: ["cpp", "py", "c", "java"] },
  queueName: { type: String, default: "compileit-v2" },
  idempotencyKey: String,
  payloadHash: String,
  executionToken: String,
  leaseExpiresAt: Date,
  attemptCount: { type: Number, default: 0 },
  resultVersion: { type: Number, default: 0 },
  code: String,
  input: String,
  testCases: [{ input: String, expected: String }],
  filepath: String,
  inputFilePath: String,
  submittedAt: { type: Date, default: Date.now, expires: 86400 },
  startedAt: Date,
  completedAt: Date,
  status: {
    type: String,
    default: "pending",
    enum: [
      "pending",
      "running",
      "success",
      "error",
      "timeout",
      "cancelled",
      "output_limit",
    ],
  },
  output: String,
  stdout: String,
  stderr: String,
  compileOutput: String,
  phase: String,
  durationMs: Number,
  totalDurationMs: Number,
  queueWaitMs: Number,
  exitCode: Number,
  signal: String,
  testResults: [mongoose.Schema.Types.Mixed],
});
JobSchema.index(
  { queueName: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  },
);
JobSchema.index({ queueName: 1, status: 1, leaseExpiresAt: 1 });
module.exports = mongoose.model("job", JobSchema);
