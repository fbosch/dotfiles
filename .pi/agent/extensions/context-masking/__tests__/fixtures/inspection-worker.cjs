const { createInterface } = require("node:readline");
(async () => {
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const job = JSON.parse(line);
    const mode = Buffer.from(job.data, "base64")[0];
    if (mode === 2) process.exit(1);
    if (mode === 3) await new Promise(() => {});
    if (mode === 5) process.exit(2);
    if (mode === 7) { process.stdout.write("x".repeat(2000)); continue; }
    process.stdout.write(JSON.stringify(mode === 1
      ? { index: job.index, ok: false, error: "bad pixels" }
      : { index: mode === 4 ? job.index + 1 : job.index, ok: true }) + "\n");
    if (mode === 6) setTimeout(() => {}, 60000);
  }
})().catch(() => { process.exitCode = 1; });
