import { tool } from "@opencode-ai/plugin"
import { executeReadonlyTool } from "./core"

export const HyprComputerUsePlugin = async () => {
  return {
    tool: {
      hypr_computer_use_readonly: tool({
        description:
          "Read-only Hyprland visibility for computer-use workflows. Supports state, snapshot, and scoped screenshot capture. Rejects clicking, typing, clipboard, dispatch, and locked-session control.",
        args: {
          mode: tool.schema
            .enum([
              "state",
              "snapshot",
              "capture",
              "browser-default",
              "browser-targets",
              "browser-capabilities",
              "app-approval",
              "click",
              "type",
              "pointer",
              "keyboard",
              "dispatch",
              "clipboard",
              "locked-use",
            ])
            .optional(),
          scope: tool.schema.enum(["active-window", "monitor", "region", "full"]).optional(),
          outputPath: tool.schema.string().optional(),
          monitor: tool.schema.string().optional(),
          region: tool.schema
            .object({
              x: tool.schema.number(),
              y: tool.schema.number(),
              width: tool.schema.number(),
              height: tool.schema.number(),
            })
            .optional(),
          allowFullDesktop: tool.schema.boolean().optional(),
          evidenceDir: tool.schema.string().optional(),
          webdriverBidiEndpoint: tool.schema.string().optional(),
          requestedRoute: tool.schema.string().optional(),
          actionSummary: tool.schema.string().optional(),
          targetHint: tool.schema.string().optional(),
          persistApproval: tool.schema.boolean().optional(),
          includeCapture: tool.schema.boolean().optional(),
        },
        async execute(args) {
          const result = await executeReadonlyTool(args)
          return JSON.stringify(result, null, 2)
        },
      }),
    },
  }
}
