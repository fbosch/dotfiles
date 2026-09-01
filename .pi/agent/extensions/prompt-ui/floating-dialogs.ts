import {
  ExtensionInputComponent,
  ExtensionSelectorComponent,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

const FLOATING_DIALOG_OVERLAY = {
  anchor: "center" as const,
  width: 72,
  maxHeight: "80%" as const,
  margin: 1,
};

const installedContexts = new WeakSet<ExtensionUIContext>();

export function installFloatingDialogs(ui: ExtensionUIContext): void {
  if (installedContexts.has(ui)) return;
  installedContexts.add(ui);

  const originalCustom = ui.custom.bind(ui);
  ui.custom = (factory, options) =>
    originalCustom(factory, {
      ...options,
      overlay: options?.overlay ?? true,
      overlayOptions: options?.overlayOptions ?? FLOATING_DIALOG_OVERLAY,
    });

  ui.select = (title, options, dialogOptions) => {
    if (dialogOptions?.signal?.aborted) return Promise.resolve(undefined);

    return ui.custom<string | undefined>((tui, _theme, _keybindings, done) => {
      const finish = (value: string | undefined) => {
        dialogOptions?.signal?.removeEventListener("abort", onAbort);
        done(value);
      };
      const onAbort = () => finish(undefined);
      dialogOptions?.signal?.addEventListener("abort", onAbort, { once: true });

      return new ExtensionSelectorComponent(title, options, finish, () => finish(undefined), {
        tui,
        ...(dialogOptions?.timeout === undefined ? {} : { timeout: dialogOptions.timeout }),
        onToggleToolsExpanded: () => ui.setToolsExpanded(ui.getToolsExpanded() === false),
      });
    });
  };

  ui.confirm = async (title, message, dialogOptions) =>
    (await ui.select(`${title}\n${message}`, ["Yes", "No"], dialogOptions)) === "Yes";

  ui.input = (title, placeholder, dialogOptions) => {
    if (dialogOptions?.signal?.aborted) return Promise.resolve(undefined);

    return ui.custom<string | undefined>((tui, _theme, _keybindings, done) => {
      const finish = (value: string | undefined) => {
        dialogOptions?.signal?.removeEventListener("abort", onAbort);
        done(value);
      };
      const onAbort = () => finish(undefined);
      dialogOptions?.signal?.addEventListener("abort", onAbort, { once: true });

      return new ExtensionInputComponent(title, placeholder, finish, () => finish(undefined), {
        tui,
        ...(dialogOptions?.timeout === undefined ? {} : { timeout: dialogOptions.timeout }),
      });
    });
  };
}
