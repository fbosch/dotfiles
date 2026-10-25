import { copyToClipboard, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, ScrollView, SelectList, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { renderCommandPermissionSections } from "./command-permission-rendering";
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
  copyCommand: (command: string) => Promise<void> = copyToClipboard,
): Promise<boolean> {
  const { command, cwd, risks, signal } = request;
  if (!ctx.hasUI || signal.aborted) return false;
  const concern = `Flagged: possible ${risks.map((risk) => risk.replace(/^a /, "")).join(" and ")}.`;
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
          let copying = false;
          let copyStatus = "";
          let cachedWidth: number | undefined;
          let cachedSelection: boolean | undefined;
          let cached: ReturnType<typeof renderCommandPermissionSections> | undefined;
          const scroll = new ScrollView({ render: () => [], invalidate() {} });
          const finish = (approved: boolean) => {
            if (finished) return;
            finished = true;
            cleanup();
            done(approved);
          };
          const choices = new SelectList(
            [
              { value: "allow", label: "Run command" },
              { value: "reject", label: "Cancel" },
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
            render: (width) => {
              if (width <= 0) return [];
              const allowSelected = choices.getSelectedItem()?.value === "allow";
              if (!cached || cachedWidth !== width || cachedSelection !== allowSelected) {
                cached = renderCommandPermissionSections(
                  { command, cwd, concern, allowSelected },
                  width,
                  theme,
                );
                cachedWidth = width;
                cachedSelection = allowSelected;
              }
              const { header, body, footer } = cached;
              const fit = (text: string) => wrapTextWithAnsi(theme.fg("muted", text), width);
              const help = [
                ...fit("PgUp/PgDn scroll · Home/End first/last"),
                ...fit(copyStatus || "Ctrl+Y copy command"),
              ];
              const rangeRows = fit(
                `Review rows ${body.length}–${body.length} of ${body.length}`,
              ).length;
              const height = Math.max(
                1,
                Math.min(
                  body.length,
                  // Leave transcript context visible instead of filling tall terminals.
                  12,
                  tui.terminal.rows - header.length - footer.length - help.length - rangeRows - 2,
                ),
              );
              // Inline custom components are opaque to the outer layout pass.
              scroll.updateLayout(body.length, height, () => tui.requestRender());
              const start = scroll.scrollTop;
              const end = Math.min(body.length, start + height);
              return [
                ...header,
                ...body.slice(start, end),
                ...fit(`Review rows ${start + 1}–${end} of ${body.length}`),
                ...help,
                ...footer,
              ];
            },
            handleInput: (data) => {
              if (finished) return;
              if (matchesKey(data, "pageUp")) scroll.scrollBy(-scroll.viewportHeight);
              else if (matchesKey(data, "pageDown")) scroll.scrollBy(scroll.viewportHeight);
              else if (matchesKey(data, "home")) scroll.scrollToStart();
              else if (matchesKey(data, "end")) scroll.scrollToEnd();
              else if (matchesKey(data, "ctrl+y")) {
                if (copying) return;
                copying = true;
                void copyCommand(command).then(
                  () => {
                    copying = false;
                    if (finished) return;
                    copyStatus = "Command copied";
                    tui.requestRender();
                  },
                  () => {
                    copying = false;
                    if (finished) return;
                    copyStatus = "Unable to copy command.";
                    tui.requestRender();
                  },
                );
              } else if (
                matchesKey(data, "left") ||
                matchesKey(data, "right") ||
                matchesKey(data, "h") ||
                matchesKey(data, "l")
              )
                choices.setSelectedIndex(choices.getSelectedItem()?.value === "allow" ? 1 : 0);
              else choices.handleInput(data);
              tui.requestRender();
            },
            handleMouse: (event) => {
              if (finished || event.type !== "wheel") return;
              scroll.scrollBy(event.wheelDelta ?? 0);
              return { handled: true };
            },
            invalidate: () => {
              cached = undefined;
              choices.invalidate();
            },
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
