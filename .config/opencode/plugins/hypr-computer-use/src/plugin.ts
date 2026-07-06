import { tool } from "@opencode-ai/plugin"
import { executeReadonlyTool } from "./core"

export const HyprComputerUsePlugin = async () => {
  return {
    tool: {
      hypr_computer_use_readonly: tool({
        description:
          "Hyprland computer-use support. Provides read-only visibility and guarded explicit keyboard input. Rejects clicking, text typing, clipboard, generic dispatch, and locked-session control.",
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
              "controls-cache",
              "click",
              "type",
              "pointer",
              "keyboard",
              "keyboard-plan",
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
          controlsCachePath: tool.schema.string().optional(),
          controls: tool.schema
            .object({
              source: tool.schema.string().optional(),
              notes: tool.schema.string().optional(),
              bindings: tool.schema
                .array(tool.schema
                  .object({
                    action: tool.schema.string(),
                    keys: tool.schema.array(tool.schema.string()),
                    note: tool.schema.string().optional(),
                  }))
                .optional(),
            })
            .optional(),
          key: tool.schema.string().optional(),
          chord: tool.schema.string().optional(),
          sequence: tool.schema.array(tool.schema.string()).optional(),
          text: tool.schema.string().optional(),
          waitMs: tool.schema.number().optional(),
          steps: tool.schema
            .array(tool.schema
              .object({
                action: tool.schema.string().optional(),
                key: tool.schema.string().optional(),
                chord: tool.schema.string().optional(),
                sequence: tool.schema.array(tool.schema.string()).optional(),
                waitMs: tool.schema.number().optional(),
              }))
            .optional(),
          approvedTarget: tool.schema
            .object({
              stableId: tool.schema.string().optional(),
              address: tool.schema.string().optional(),
              class: tool.schema.string().optional(),
              title: tool.schema.string().optional(),
              workspace: tool.schema
                .object({
                  id: tool.schema.number().optional(),
                  name: tool.schema.string().optional(),
                })
                .optional(),
              monitor: tool.schema.number().optional(),
              monitorName: tool.schema.string().optional(),
            })
            .optional(),
        },
        async execute(args) {
          const result = await executeReadonlyTool(args)
          return JSON.stringify(result, null, 2)
        },
      }),
    },
  }
}
