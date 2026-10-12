const { createHash } = require("node:crypto");
function validateKey(key) {
  if (
    key !== undefined &&
    (typeof key !== "string" || !/^[a-zA-Z0-9._:-]{8,128}$/.test(key))
  ) {
    throw Object.assign(
      new Error(
        "Idempotency-Key must contain 8–128 letters, numbers, dots, underscores, colons, or hyphens.",
      ),
      { status: 400 },
    );
  }
}
function payloadDigest(payload) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        language: payload.language,
        code: payload.code,
        input: payload.input || "",
        testCases: (payload.testCases || []).map((test) => ({
          input: test.input,
          expected: test.expected,
        })),
      }),
    )
    .digest("hex");
}
function verifyReplay(job, digest) {
  if (job.payloadHash !== digest)
    throw Object.assign(
      new Error(
        "This Idempotency-Key was already used for a different submission.",
      ),
      { status: 409 },
    );
  return String(job._id);
}
module.exports = { validateKey, payloadDigest, verifyReplay };
