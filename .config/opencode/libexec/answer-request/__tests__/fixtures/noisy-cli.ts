import { runAnswerRequestProcess } from "../../cli-runtime.js";

await runAnswerRequestProcess(async (request) => {
  process.stdout.write("stdout noise\n");
  process.stderr.write(`stderr secret: ${request.prompt}\n`);
  setTimeout(() => process.stdout.write("delayed noise\n"), 1);
  return {
    protocolVersion: 1,
    requestId: request.requestId,
    ok: true,
    answer: "A bounded answer.",
    truncated: false,
  };
});
