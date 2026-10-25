import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readNonoCapabilities } from "../../lib/nono-capabilities";
import { registerSandboxGuidance } from "./prompt";
import { explain, list, parseRequest, summarize, USAGE } from "./report";

export default function sandbox(pi: ExtensionAPI): void {
  registerSandboxGuidance(pi);
  pi.registerCommand("sandbox", {
    description: "Show effective nono capabilities or explain access to a path",
    handler: async (args, ctx) => {
      const request = parseRequest(args);
      if (request.kind === "invalid") {
        ctx.ui.notify(USAGE, "warning");
        return;
      }
      const capabilities = readNonoCapabilities();
      if (!capabilities) {
        ctx.ui.notify(
          "No readable nono capability metadata. Pi was launched without nono, or NONO_CAP_FILE is missing or invalid.",
          "info",
        );
        return;
      }
      const message =
        request.kind === "summary"
          ? summarize(capabilities)
          : request.kind === "list"
            ? list(capabilities, request.topic)
            : explain(capabilities, ctx.cwd, request.target, request.access);
      ctx.ui.notify(message, "info");
    },
  });
}
