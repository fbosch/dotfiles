import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  getKeybindings,
  Input,
  type SelectItem,
  SelectList,
  Spacer,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  DOCK_CHROME_WIDTH,
  DOCK_RAIL,
  DOCK_RIGHT_BORDER,
  paintDockBottomEdge,
  paintDockRow,
} from "./dock-rendering";
import {
  MODAL_FIXED_ROWS,
  MODAL_MAX_VISIBLE_ITEMS,
  MODAL_WIDTH,
  ModalFrame,
  modalSelectListTheme,
} from "./modal-frame";

const FLOATING_DIALOG_OVERLAY = {
  anchor: "center" as const,
  width: MODAL_WIDTH,
  margin: 1,
};

const installedContexts = new WeakSet<ExtensionUIContext>();
const INLINE_DIALOG_PADDING_X = 1;

class InlineDockDialog implements Component {
  constructor(
    private readonly component: Component & { dispose?(): void },
    private readonly theme: Theme,
  ) {
    if ("focused" in component) {
      const focusable = component as Component & { focused: boolean };
      Object.defineProperty(this, "focused", {
        get: () => focusable.focused,
        set: (focused: boolean) => {
          focusable.focused = focused;
        },
      });
    }
    if (component.wantsKeyRelease !== undefined) {
      Object.defineProperty(this, "wantsKeyRelease", {
        get: () => component.wantsKeyRelease,
      });
    }
  }

  render(width: number): string[] {
    if (width <= DOCK_CHROME_WIDTH) return this.component.render(width);

    const availableWidth = width - DOCK_CHROME_WIDTH;
    const paddingX =
      availableWidth >= INLINE_DIALOG_PADDING_X * 2 + 1 ? INLINE_DIALOG_PADDING_X : 0;
    const contentWidth = availableWidth - paddingX * 2;
    const backgroundAnsi = this.theme.getBgAnsi("userMessageBg");
    const rail = this.theme.fg("warning", DOCK_RAIL);
    const rightBorder = this.theme.fg("borderMuted", DOCK_RIGHT_BORDER);
    const content = this.component
      .render(contentWidth)
      .map((line) => `${" ".repeat(paddingX)}${line}`);
    const rows = ["", ...content, ""].map((line) =>
      paintDockRow(line, width, rail, backgroundAnsi, rightBorder),
    );

    return [
      ...rows,
      paintDockBottomEdge(
        width,
        this.theme.fg("warning", "▘"),
        this.theme.fg("borderMuted", "▝"),
        backgroundAnsi,
      ),
    ];
  }

  handleInput(data: string): void {
    this.component.handleInput?.(data);
  }

  invalidate(): void {
    this.component.invalidate();
  }

  dispose(): void {
    this.component.dispose?.();
  }
}

class FloatingSelectDialog extends ModalFrame {
  private readonly input = new Input();
  private readonly tui: TUI;
  private readonly title: string;
  private readonly options: string[];
  private readonly done: (value: string | undefined) => void;
  private list: SelectList;
  private focusedState = false;
  private timeout: ReturnType<typeof setTimeout> | undefined;

  constructor(
    tui: TUI,
    theme: Theme,
    title: string,
    options: string[],
    done: (value: string | undefined) => void,
    timeoutMs?: number,
  ) {
    super(theme);
    this.tui = tui;
    this.title = title;
    this.options = options;
    this.done = done;
    this.list = this.createList();
    this.renderContent();
    if (timeoutMs !== undefined) this.timeout = setTimeout(() => done(undefined), timeoutMs);
  }

  get focused(): boolean {
    return this.focusedState;
  }

  set focused(focused: boolean) {
    this.focusedState = focused;
    this.input.focused = focused;
  }

  handleInput(data: string): void {
    const keybindings = getKeybindings();
    if (keybindings.matches(data, "tui.select.cancel")) {
      this.done(undefined);
      return;
    }
    if (
      keybindings.matches(data, "tui.select.up") ||
      keybindings.matches(data, "tui.select.down") ||
      keybindings.matches(data, "tui.select.confirm")
    ) {
      this.list.handleInput(data);
      this.tui.requestRender();
      return;
    }

    const previousQuery = this.input.getValue();
    this.input.handleInput(data);
    if (this.input.getValue() === previousQuery) return;

    this.list = this.createList(this.input.getValue());
    this.renderContent();
    this.tui.requestRender();
  }

  dispose(): void {
    if (this.timeout !== undefined) clearTimeout(this.timeout);
  }

  private createList(query = ""): SelectList {
    const normalizedQuery = query.trim().toLowerCase();
    const options = normalizedQuery
      ? this.options.filter((option) => option.toLowerCase().includes(normalizedQuery))
      : this.options;
    const list = new SelectList(
      options.map((option) => ({ value: option, label: option })),
      Math.max(1, Math.min(MODAL_MAX_VISIBLE_ITEMS, this.tui.terminal.rows - MODAL_FIXED_ROWS - 1)),
      modalSelectListTheme(this.theme),
    );
    list.onSelect = (selected: SelectItem) => this.done(selected.value);
    list.onCancel = () => this.done(undefined);
    return list;
  }

  private renderContent(): void {
    this.setFrame(
      this.title,
      [this.input, new Spacer(1), this.list],
      "  ↑↓ navigate · Enter select · Esc close",
    );
  }
}

class FloatingInputDialog extends ModalFrame {
  private readonly input = new Input();
  private readonly tui: TUI;
  private readonly done: (value: string | undefined) => void;
  private timeout: ReturnType<typeof setTimeout> | undefined;

  constructor(
    tui: TUI,
    theme: Theme,
    title: string,
    done: (value: string | undefined) => void,
    timeoutMs?: number,
  ) {
    super(theme);
    this.tui = tui;
    this.done = done;
    this.setFrame(title, [this.input], "  Enter submit · Esc close");
    if (timeoutMs !== undefined) this.timeout = setTimeout(() => done(undefined), timeoutMs);
  }

  get focused(): boolean {
    return this.input.focused;
  }

  set focused(focused: boolean) {
    this.input.focused = focused;
  }

  handleInput(data: string): void {
    const keybindings = getKeybindings();
    if (keybindings.matches(data, "tui.select.confirm")) {
      this.done(this.input.getValue());
      return;
    }
    if (keybindings.matches(data, "tui.select.cancel")) {
      this.done(undefined);
      return;
    }

    this.input.handleInput(data);
    this.tui.requestRender();
  }

  dispose(): void {
    if (this.timeout !== undefined) clearTimeout(this.timeout);
  }
}

export function installFloatingDialogs(ui: ExtensionUIContext): void {
  if (installedContexts.has(ui)) return;
  installedContexts.add(ui);

  const originalCustom = ui.custom.bind(ui);
  ui.custom = (factory, options) => {
    if (options?.overlay === false) {
      return originalCustom(
        async (tui, theme, keybindings, done) =>
          new InlineDockDialog(await factory(tui, theme, keybindings, done), theme),
        options,
      );
    }

    return originalCustom(factory, {
      ...options,
      overlay: true,
      overlayOptions: options?.overlayOptions ?? FLOATING_DIALOG_OVERLAY,
    });
  };

  ui.select = (title, options, dialogOptions) => {
    if (dialogOptions?.signal?.aborted) return Promise.resolve(undefined);

    return ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
      const finish = (value: string | undefined) => {
        dialogOptions?.signal?.removeEventListener("abort", onAbort);
        done(value);
      };
      const onAbort = () => finish(undefined);
      dialogOptions?.signal?.addEventListener("abort", onAbort, { once: true });

      return new FloatingSelectDialog(tui, theme, title, options, finish, dialogOptions?.timeout);
    });
  };

  ui.confirm = async (title, message, dialogOptions) =>
    (await ui.select(`${title}\n${message}`, ["Yes", "No"], dialogOptions)) === "Yes";

  ui.input = (title, _placeholder, dialogOptions) => {
    if (dialogOptions?.signal?.aborted) return Promise.resolve(undefined);

    return ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
      const finish = (value: string | undefined) => {
        dialogOptions?.signal?.removeEventListener("abort", onAbort);
        done(value);
      };
      const onAbort = () => finish(undefined);
      dialogOptions?.signal?.addEventListener("abort", onAbort, { once: true });

      return new FloatingInputDialog(tui, theme, title, finish, dialogOptions?.timeout);
    });
  };
}
