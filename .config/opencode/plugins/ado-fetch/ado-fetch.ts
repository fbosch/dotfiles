import { tool, type Plugin } from "@opencode-ai/plugin";
import { join } from "node:path";

const LIBEXEC_DIRECTORY = join(import.meta.dir, "..", "libexec");
const SCRIPTS = {
  "pr-review": join(import.meta.dir, "..", "scripts", "fetch-ado-pr.sh"),
  pbi: join(LIBEXEC_DIRECTORY, "azure", "ado_pbi_fetch.ts"),
  "test-case": join(LIBEXEC_DIRECTORY, "azure", "ado_case_fetch.ts"),
} as const;

export const AdoFetchPlugin: Plugin = async ({ directory }) => ({
  tool: {
    ado_fetch: tool({
      description: "Fetch Azure DevOps pull-request, backlog-item, or test-case data without shell interpolation.",
      args: {
        kind: tool.schema.enum(["pr-review", "pbi", "test-case"]),
        input: tool.schema.string().optional(),
      },
      async execute({ kind, input }) {
        const command = kind === "pr-review"
          ? ["bash", SCRIPTS[kind], input ?? ""]
          : ["bun", "--cwd", LIBEXEC_DIRECTORY, SCRIPTS[kind], input ?? ""];
        const child = Bun.spawn(command, {
          cwd: directory,
          env: { ...process.env, OPENCODE_LIBEXEC_CWD: directory },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);

        if (exitCode === 0) return stdout;
        return `ERROR: ${stderr.trim() || `Azure DevOps fetch failed with exit code ${exitCode}`}`;
      },
    }),
  },
});

export default AdoFetchPlugin;
