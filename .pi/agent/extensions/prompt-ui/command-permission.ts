import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, SelectList } from "@earendil-works/pi-tui";
import { renderCommandPermissionLines } from "./command-permission-rendering";
import { modalSelectListTheme } from "./modal-frame";

interface CommandPermission {
  command: string;
  cwd: string;
  risks: readonly string[];
  signal: AbortSignal;
}

export async function confirmCommandPermission(
  ctx: Pick<ExtensionContext, "mode" | "hasUI" | "ui">,
  request: CommandPermission,
): Promise<boolean> {
  const { command, cwd, risks, signal } = request;
  if (!ctx.hasUI || signal.aborted) return false;
  const concern = `Possible ${risks.map((risk) => risk.replace(/^a /, "")).join(" and ")}.`;
  const commandText = JSON.stringify(command);
  const directoryText = JSON.stringify(cwd);
  // RPC supports standard dialogs, but not custom terminal components.
  if (ctx.mode !== "tui")
    return ctx.ui.confirm(
      "Run this bash command?",
      `${concern}\n\nWorking directory: ${directoryText}\n\nCommand: ${commandText}`,
      { signal },
    );

  let cleanup = () => {};
  try {
    return (
      (await ctx.ui.custom<boolean>(
        (tui, theme, _keybindings, done) => {
          let finished = false;
          const finish = (approved: boolean) => {
            if (finished) return;
            finished = true;
            cleanup();
            done(approved);
          };
          const choices = new SelectList(
            [
              { value: "allow", label: "Allow once" },
              { value: "reject", label: "Reject" },
            ],
            2,
            modalSelectListTheme(theme),
          );
          choices.onSelect = (item) => finish(item.value === "allow");
          choices.onCancel = () => finish(false);
          choices.onSelectionChange = () => tui.requestRender();
          const onAbort = () => finish(false);
          cleanup = () => signal.removeEventListener("abort", onAbort);
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) finish(false);

          return {
            render: (width) =>
              renderCommandPermissionLines(
                {
                  command,
                  cwd,
                  concern,
                  allowSelected: choices.getSelectedItem()?.value === "allow",
                },
                width,
                theme,
              ),
            handleInput: (data) => {
              if (finished) return;
              if (
                matchesKey(data, "left") ||
                matchesKey(data, "right") ||
                matchesKey(data, "h") ||
                matchesKey(data, "l")
              )
                choices.setSelectedIndex(choices.getSelectedItem()?.value === "allow" ? 1 : 0);
              else choices.handleInput(data);
              tui.requestRender();
            },
            invalidate: () => choices.invalidate(),
            dispose: () => {
              finished = true;
              cleanup();
            },
          };
        },
        { overlay: false },
      )) === true
    );
  } finally {
    cleanup();
  }
}
