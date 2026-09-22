import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import type { DeltaDetails, DeltaResult, GitDiffRunner } from "./shared";
import { diagnostic } from "./shared";

export async function runDeltaCommand(
  context: ExtensionCommandContext,
  run: GitDiffRunner,
  appendEntry: (details: DeltaDetails) => void,
): Promise<void> {
  const outcome = await context.ui.custom<
    | { readonly status: "cancelled" }
    | { readonly message: string; readonly status: "error" }
    | { readonly result: DeltaResult; readonly status: "success" }
  >((tui, theme, _keybindings, done) => {
    const loader = new BorderedLoader(tui, theme, "Rendering Git diff with Delta...");
    let settled = false;
    const finish = (
      result:
        | { readonly status: "cancelled" }
        | { readonly message: string; readonly status: "error" }
        | { readonly result: DeltaResult; readonly status: "success" },
    ) => {
      if (settled) return;
      settled = true;
      done(result);
    };
    loader.onAbort = () => finish({ status: "cancelled" });
    run({}, context.cwd, loader.signal).then(
      (result) => finish({ result, status: "success" }),
      (error: unknown) => {
        if (loader.signal.aborted) {
          finish({ status: "cancelled" });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        finish({ message: diagnostic(message), status: "error" });
      },
    );
    return loader;
  });

  if (outcome.status === "cancelled") {
    context.ui.notify("Delta diff cancelled.", "info");
    return;
  }
  if (outcome.status === "error") {
    context.ui.notify(outcome.message, "error");
    return;
  }
  appendEntry(outcome.result.details);
}
