// Only runs inside the restricted runner container.
const { execute } = require("./runner");
let body = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  body += chunk;
});
process.stdin.on("end", async () => {
  try {
    process.stdout.write(
      JSON.stringify(await execute(JSON.parse(body), { mode: "local" })),
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({ status: "error", output: error.message }),
    );
  }
});
