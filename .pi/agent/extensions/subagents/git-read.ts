import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Read-only reviewers need diffs without receiving an unrestricted shell tool.
const parameters = Type.Object({ staged: Type.Optional(Type.Boolean()) });
export default function gitRead(pi: Pick<ExtensionAPI, "exec"> & {
  registerTool(tool: import("@earendil-works/pi-coding-agent").ToolDefinition<typeof parameters>): void;
}): void {
  pi.registerTool({
    name: "git_diff",
    label: "Read Git diff",
    description: "Read the working-tree or staged diff without running external diff drivers.",
    parameters,
    async execute(_id, args, signal, _update, ctx) {
      const result = await pi.exec("git", [
        "--no-pager", "diff", "--no-ext-diff", "--no-textconv",
        ...(args.staged ? ["--cached"] : []), "--",
      ], { cwd: ctx.cwd, ...(signal ? { signal } : {}) });
      if (result.code !== 0) throw new Error(result.stderr || "Git diff failed");
      return { content: [{ type: "text", text: result.stdout || "No changes." }], details: undefined };
    },
  });
}
