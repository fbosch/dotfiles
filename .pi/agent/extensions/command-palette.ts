import {
  DynamicBorder,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  SessionManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  getKeybindings,
  Input,
  type SelectItem,
  SelectList,
  Spacer,
  Text,
  type TUI,
} from "@earendil-works/pi-tui";

type PaletteAction = () => Promise<void> | void;

interface PaletteItem {
  id: string;
  label: string;
  description: string;
  action?: PaletteAction;
  children?: () => PaletteItem[] | Promise<PaletteItem[]>;
}

interface PaletteLevel {
  title: string;
  items: PaletteItem[];
  input: Input;
  list: SelectList;
}

const PALETTE_WIDTH = 72;
const MAX_VISIBLE_ITEMS = 10;

function isCommandContext(ctx: ExtensionContext): ctx is ExtensionCommandContext {
  return "newSession" in ctx;
}

function selectListTheme(theme: Theme) {
  return {
    selectedPrefix: (text: string) => theme.fg("accent", text),
    selectedText: (text: string) => theme.fg("accent", text),
    description: (text: string) => theme.fg("muted", text),
    scrollInfo: (text: string) => theme.fg("muted", text),
    noMatch: (text: string) => theme.fg("muted", text),
  };
}

class CommandPalette extends Container {
  private readonly levels: PaletteLevel[] = [];
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly done: (action: PaletteAction | null) => void;
  private focusedState = false;

  constructor(
    tui: TUI,
    theme: Theme,
    items: PaletteItem[],
    done: (action: PaletteAction | null) => void,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    this.pushLevel("Command Palette", items);
  }

  get focused(): boolean {
    return this.focusedState;
  }

  set focused(focused: boolean) {
    this.focusedState = focused;
    const level = this.currentLevel();
    if (level) level.input.focused = focused;
  }

  handleInput(data: string): void {
    const level = this.currentLevel();
    if (!level) return;

    const keybindings = getKeybindings();
    if (keybindings.matches(data, "tui.select.cancel")) {
      this.cancel();
      return;
    }

    if (
      keybindings.matches(data, "tui.select.up") ||
      keybindings.matches(data, "tui.select.down") ||
      keybindings.matches(data, "tui.select.confirm")
    ) {
      level.list.handleInput(data);
      this.tui.requestRender();
      return;
    }

    const previousQuery = level.input.getValue();
    level.input.handleInput(data);
    if (level.input.getValue() === previousQuery) return;

    level.list = this.createList(level.items, level.input.getValue());
    this.renderLevel();
    this.tui.requestRender();
  }

  private currentLevel(): PaletteLevel | undefined {
    return this.levels.at(-1);
  }

  private pushLevel(title: string, items: PaletteItem[]): void {
    const input = new Input();
    input.focused = this.focusedState;
    const level: PaletteLevel = {
      title,
      items,
      input,
      list: this.createList(items),
    };
    this.levels.push(level);
    this.renderLevel();
  }

  private createList(items: PaletteItem[], query = ""): SelectList {
    const normalizedQuery = query.trim().toLowerCase();
    const filteredItems = normalizedQuery
      ? items.filter((item) =>
          `${item.label} ${item.description}`.toLowerCase().includes(normalizedQuery),
        )
      : items;
    const list = new SelectList(
      filteredItems.map((item) => ({
        value: item.id,
        label: item.label,
        description: item.description,
      })),
      MAX_VISIBLE_ITEMS,
      selectListTheme(this.theme),
      { minPrimaryColumnWidth: 18, maxPrimaryColumnWidth: 32 },
    );
    list.onSelect = (selected) => void this.select(selected);
    list.onCancel = () => this.cancel();
    return list;
  }

  private async select(selected: SelectItem): Promise<void> {
    const level = this.currentLevel();
    const item = level?.items.find((candidate) => candidate.id === selected.value);
    if (!item) return;

    if (item.children) {
      this.pushLevel(item.label, await item.children());
      this.tui.requestRender();
      return;
    }

    this.done(item.action ?? null);
  }

  private cancel(): void {
    if (this.levels.length === 1) {
      this.done(null);
      return;
    }

    this.levels.pop();
    const level = this.currentLevel();
    if (level) level.input.focused = this.focusedState;
    this.renderLevel();
    this.tui.requestRender();
  }

  private renderLevel(): void {
    const level = this.currentLevel();
    if (!level) return;

    this.clear();
    const border = () => new DynamicBorder((text) => this.theme.fg("borderAccent", text));
    const breadcrumb = this.levels.map(({ title }) => title).join("  ›  ");

    this.addChild(border());
    this.addChild(new Spacer(1));
    this.addChild(new Text(this.theme.bold(this.theme.fg("accent", breadcrumb)), 0, 0));
    this.addChild(new Spacer(1));
    this.addChild(level.input);
    this.addChild(new Spacer(1));
    this.addChild(level.list);
    this.addChild(new Spacer(1));
    this.addChild(
      new Text(this.theme.fg("dim", "  ↑↓ navigate · Enter select · Esc back or close"), 0, 0),
    );
    this.addChild(new Spacer(1));
    this.addChild(border());
  }
}

function modelItems(ctx: ExtensionContext, pi: ExtensionAPI): PaletteItem[] {
  const models =
    ctx.scopedModels.length > 0
      ? ctx.scopedModels.map(({ model }) => model)
      : ctx.modelRegistry.getAvailable();

  return models.map((model) => ({
    id: `model:${model.provider}/${model.id}`,
    label: model.id,
    description: model.provider,
    action: async () => {
      const selected = await pi.setModel(model);
      if (selected === false) {
        ctx.ui.notify(`Could not select ${model.provider}/${model.id}`, "warning");
      }
    },
  }));
}

function thinkingItems(ctx: ExtensionContext, pi: ExtensionAPI): PaletteItem[] {
  const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
  const currentLevel = pi.getThinkingLevel();

  return levels.map((level) => ({
    id: `thinking:${level}`,
    label: level,
    description: level === currentLevel ? "current" : "",
    action: () => {
      pi.setThinkingLevel(level);
      ctx.ui.notify(`Thinking: ${level}`, "info");
    },
  }));
}

function toolItems(pi: ExtensionAPI): PaletteItem[] {
  const activeTools = pi.getActiveTools();

  return pi.getAllTools().map((tool) => {
    const active = activeTools.includes(tool.name);
    return {
      id: `tool:${tool.name}`,
      label: `${active ? "✓" : " "} ${tool.name}`,
      description: active ? "enabled" : "disabled",
      action: () => {
        pi.setActiveTools(
          active ? activeTools.filter((name) => name !== tool.name) : [...activeTools, tool.name],
        );
      },
    };
  });
}

async function sessionItems(ctx: ExtensionCommandContext): Promise<PaletteItem[]> {
  const sessions = await SessionManager.list(ctx.cwd);
  return sessions
    .sort((left, right) => right.modified.getTime() - left.modified.getTime())
    .slice(0, 25)
    .map((session) => ({
      id: `session:${session.id}`,
      label: session.name ?? (session.firstMessage || session.id),
      description: session.modified.toLocaleString(),
      action: async () => {
        await ctx.switchSession(session.path);
      },
    }));
}

function rootItems(ctx: ExtensionContext, pi: ExtensionAPI): PaletteItem[] {
  const items: PaletteItem[] = [
    {
      id: "model",
      label: "Switch Model",
      description: "Choose from available models",
      children: () => modelItems(ctx, pi),
    },
    {
      id: "thinking",
      label: "Set Thinking Level",
      description: "Change reasoning depth",
      children: () => thinkingItems(ctx, pi),
    },
    {
      id: "compact",
      label: "Compact Session",
      description: "Compact the current context",
      action: () => ctx.compact(),
    },
    {
      id: "tools",
      label: "Toggle Tool",
      description: "Enable or disable a tool",
      children: () => toolItems(pi),
    },
  ];

  if (isCommandContext(ctx) === false) return items;

  items.splice(
    2,
    0,
    {
      id: "new-session",
      label: "New Session",
      description: "Start a fresh session",
      action: async () => {
        await ctx.newSession();
      },
    },
    {
      id: "fork-session",
      label: "Fork Session",
      description: "Start a linked session",
      action: async () => {
        const parentSession = ctx.sessionManager.getSessionFile();
        await ctx.newSession(parentSession ? { parentSession } : {});
      },
    },
    {
      id: "resume-session",
      label: "Resume Session",
      description: "Switch to a recent session",
      children: () => sessionItems(ctx),
    },
  );
  items.push({
    id: "reload",
    label: "Reload",
    description: "Reload extensions and configuration",
    action: async () => {
      await ctx.reload();
    },
  });

  return items;
}

async function showPalette(ctx: ExtensionContext, pi: ExtensionAPI) {
  if (ctx.mode !== "tui") return;

  const action = await ctx.ui.custom<PaletteAction | null>(
    (tui, theme, _keybindings, done) => new CommandPalette(tui, theme, rootItems(ctx, pi), done),
    {
      overlay: true,
      overlayOptions: {
        anchor: "top-center",
        width: PALETTE_WIDTH,
        margin: { top: 3 },
        nonCapturing: true,
      },
      onHandle: (handle) => handle.focus(),
    },
  );

  await action?.();
}

export default function commandPalette(pi: ExtensionAPI) {
  pi.registerShortcut("ctrl+p", {
    description: "Open command palette",
    handler: async (ctx) => showPalette(ctx, pi),
  });

  pi.registerCommand("palette", {
    description: "Open command palette",
    handler: async (_args, ctx) => showPalette(ctx, pi),
  });
}
