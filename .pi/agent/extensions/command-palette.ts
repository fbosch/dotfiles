import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  SessionManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  getKeybindings,
  Input,
  type SelectItem,
  SelectList,
  Spacer,
  sliceByColumn,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  MODAL_FIXED_ROWS,
  MODAL_MAX_VISIBLE_ITEMS,
  MODAL_WIDTH,
  ModalFrame,
  modalSelectListTheme,
} from "./prompt-ui/modal-frame";

type PaletteAction = () => Promise<void> | void;

export interface PaletteItem {
  id: string;
  label: string;
  description: string;
  shortcut?: string;
  action?: PaletteAction;
  children?: () => PaletteItem[] | Promise<PaletteItem[]>;
}

export interface PaletteSection {
  id: string;
  label: string;
  items: PaletteItem[];
}

interface PaletteList extends Component {
  onSelect?: (item: SelectItem) => void;
  onCancel?: () => void;
  handleInput(data: string): void;
}

interface PaletteLevel {
  title: string;
  items: PaletteItem[];
  input: Input;
  list: PaletteList;
  sections?: PaletteSection[];
}

const MAX_VISIBLE_ROOT_ROWS = 24;

function isCommandContext(ctx: ExtensionContext): ctx is ExtensionCommandContext {
  return "newSession" in ctx;
}

function truncatePlainText(text: string, maxWidth: number, pad = false): string {
  if (maxWidth <= 0) return "";

  const textWidth = visibleWidth(text);
  if (textWidth <= maxWidth) {
    return pad ? text + " ".repeat(maxWidth - textWidth) : text;
  }

  const prefix = sliceByColumn(text, 0, Math.max(0, maxWidth - 1), true);
  const truncated = `${prefix}…`;
  return pad ? truncated + " ".repeat(maxWidth - visibleWidth(truncated)) : truncated;
}

interface SectionedSelectItem extends SelectItem {
  shortcut?: string;
}

interface SectionedSelectSection {
  label: string;
  items: SectionedSelectItem[];
}

interface SectionedSelectListTheme {
  header: (text: string) => string;
  label: (text: string) => string;
  description: (text: string) => string;
  shortcut: (text: string) => string;
  selected: (text: string) => string;
  scrollInfo: (text: string) => string;
  noMatch: (text: string) => string;
}

type SectionedRow =
  | { kind: "spacer" }
  | { kind: "header"; label: string }
  | { kind: "item"; item: SectionedSelectItem; itemIndex: number; sectionLabel: string };

export class SectionedSelectList implements Component {
  onSelect?: (item: SelectItem) => void;
  onCancel?: () => void;

  private readonly items: SectionedSelectItem[];
  private selectedIndex = 0;

  constructor(
    private readonly sections: SectionedSelectSection[],
    private readonly maxVisibleRows: number,
    private readonly theme: SectionedSelectListTheme,
  ) {
    this.items = sections.flatMap((section) => section.items);
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.items.length === 0) {
      return [this.theme.noMatch("  No matching commands")];
    }

    const rows = this.rows();
    const showScrollInfo = this.maxVisibleRows > 1 && rows.length > this.maxVisibleRows;
    const contentRows = Math.max(1, this.maxVisibleRows - (showScrollInfo ? 1 : 0));
    const selectedRowIndex = rows.findIndex(
      (row) => row.kind === "item" && row.itemIndex === this.selectedIndex,
    );
    const maxStart = Math.max(0, rows.length - contentRows);
    const start = Math.max(0, Math.min(selectedRowIndex - Math.floor(contentRows / 2), maxStart));
    let visibleRows = rows.slice(start, start + contentRows);
    while (visibleRows[0]?.kind === "spacer") visibleRows.shift();

    if (visibleRows[0]?.kind === "item" && contentRows > 1) {
      const selectedVisibleIndex = visibleRows.findIndex(
        (row) => row.kind === "item" && row.itemIndex === this.selectedIndex,
      );
      const sectionRows =
        selectedVisibleIndex === visibleRows.length - 1
          ? visibleRows.slice(1)
          : visibleRows.slice(0, contentRows - 1);
      while (sectionRows[0]?.kind === "spacer") sectionRows.shift();

      const firstSectionRow = sectionRows[0];
      visibleRows =
        firstSectionRow?.kind === "item"
          ? [{ kind: "header", label: firstSectionRow.sectionLabel }, ...sectionRows]
          : sectionRows;
    }

    while (visibleRows.length > 0 && visibleRows.at(-1)?.kind !== "item") visibleRows.pop();

    const lines = visibleRows.map((row) => this.renderRow(row, width));
    if (showScrollInfo) {
      lines.push(this.theme.scrollInfo(`  (${this.selectedIndex + 1}/${this.items.length})`));
    }
    return lines;
  }

  handleInput(data: string): void {
    const keybindings = getKeybindings();
    if (keybindings.matches(data, "tui.select.up")) {
      this.moveSelection(-1);
      return;
    }
    if (keybindings.matches(data, "tui.select.down")) {
      this.moveSelection(1);
      return;
    }
    if (keybindings.matches(data, "tui.select.confirm")) {
      const selectedItem = this.items[this.selectedIndex];
      if (selectedItem) this.onSelect?.(selectedItem);
      return;
    }
    if (keybindings.matches(data, "tui.select.cancel")) this.onCancel?.();
  }

  getSelectedItem(): SelectItem | null {
    return this.items[this.selectedIndex] ?? null;
  }

  private moveSelection(offset: number): void {
    if (this.items.length === 0) return;
    this.selectedIndex = (this.selectedIndex + offset + this.items.length) % this.items.length;
  }

  private rows(): SectionedRow[] {
    const rows: SectionedRow[] = [];
    let itemIndex = 0;

    for (const [sectionIndex, section] of this.sections.entries()) {
      if (sectionIndex > 0) rows.push({ kind: "spacer" });
      rows.push({ kind: "header", label: section.label });
      for (const item of section.items) {
        rows.push({ kind: "item", item, itemIndex, sectionLabel: section.label });
        itemIndex += 1;
      }
    }

    return rows;
  }

  private renderRow(row: SectionedRow, width: number): string {
    if (row.kind === "spacer") return "";
    if (row.kind === "header") {
      return this.theme.header(truncatePlainText(`  ${row.label}`, width));
    }

    return this.renderItem(row.item, row.itemIndex === this.selectedIndex, width);
  }

  private renderItem(item: SectionedSelectItem, selected: boolean, width: number): string {
    const prefix = selected ? "› " : "  ";
    const shortcut = item.shortcut ?? "";
    const shortcutWidth = visibleWidth(shortcut);
    const shortcutGap = shortcutWidth > 0 ? 2 : 0;
    const contentWidth = Math.max(1, width - visibleWidth(prefix) - shortcutWidth - shortcutGap);

    if (selected) {
      const content = truncatePlainText(
        `${item.label}${item.description ? `  ${item.description}` : ""}`,
        contentWidth,
        true,
      );
      const line = `${prefix}${content}${" ".repeat(shortcutGap)}${shortcut}`;
      return this.theme.selected(line);
    }

    const label = truncatePlainText(item.label, contentWidth);
    const descriptionWidth = contentWidth - visibleWidth(label) - 2;
    const description =
      item.description && descriptionWidth > 8
        ? this.theme.description(`  ${truncatePlainText(item.description, descriptionWidth)}`)
        : "";
    const content = `${this.theme.label(label)}${description}`;
    const spacing = " ".repeat(
      Math.max(0, width - visibleWidth(prefix) - visibleWidth(content) - shortcutWidth),
    );
    return `${prefix}${content}${spacing}${this.theme.shortcut(shortcut)}`;
  }
}

function sectionedSelectListTheme(theme: Theme): SectionedSelectListTheme {
  return {
    header: (text) => theme.bold(theme.fg("accent", text)),
    label: (text) => theme.fg("text", text),
    description: (text) => theme.fg("muted", text),
    shortcut: (text) => theme.fg("dim", text),
    selected: (text) => theme.bg("selectedBg", theme.fg("text", text)),
    scrollInfo: (text) => theme.fg("muted", text),
    noMatch: (text) => theme.fg("muted", text),
  };
}

export function filterPaletteSections(sections: PaletteSection[], query: string): PaletteSection[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery === "") return sections;

  return sections
    .map((section) => {
      const items = section.label.toLowerCase().includes(normalizedQuery)
        ? section.items
        : section.items.filter((item) =>
            `${item.label} ${item.description}`.toLowerCase().includes(normalizedQuery),
          );
      return { ...section, items };
    })
    .filter((section) => section.items.length > 0);
}

class CommandPalette extends ModalFrame {
  private readonly levels: PaletteLevel[] = [];
  private readonly tui: TUI;
  private readonly done: (action: PaletteAction | null) => void;
  private focusedState = false;

  constructor(
    tui: TUI,
    theme: Theme,
    sections: PaletteSection[],
    done: (action: PaletteAction | null) => void,
  ) {
    super(theme);
    this.tui = tui;
    this.done = done;
    this.pushLevel(
      "Commands",
      sections.flatMap((section) => section.items),
      sections,
    );
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

    level.list = level.sections
      ? this.createSectionedList(level.sections, level.input.getValue())
      : this.createList(level.items, level.input.getValue());
    this.renderLevel();
    this.tui.requestRender();
  }

  private currentLevel(): PaletteLevel | undefined {
    return this.levels.at(-1);
  }

  private pushLevel(title: string, items: PaletteItem[], sections?: PaletteSection[]): void {
    const input = new Input();
    input.focused = this.focusedState;
    const level: PaletteLevel = {
      title,
      items,
      input,
      list: sections ? this.createSectionedList(sections) : this.createList(items),
      ...(sections ? { sections } : {}),
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
      Math.max(1, Math.min(MODAL_MAX_VISIBLE_ITEMS, this.tui.terminal.rows - MODAL_FIXED_ROWS - 1)),
      modalSelectListTheme(this.theme),
      { minPrimaryColumnWidth: 18, maxPrimaryColumnWidth: 32 },
    );
    list.onSelect = (selected) => void this.select(selected);
    list.onCancel = () => this.cancel();
    return list;
  }

  private createSectionedList(sections: PaletteSection[], query = ""): SectionedSelectList {
    const filteredSections = filterPaletteSections(sections, query).map((section) => ({
      label: section.label,
      items: section.items.map((item) => ({
        value: item.id,
        label: item.label,
        description: item.description,
        ...(item.shortcut ? { shortcut: item.shortcut } : {}),
      })),
    }));
    const list = new SectionedSelectList(
      filteredSections,
      Math.max(1, Math.min(MAX_VISIBLE_ROOT_ROWS, this.tui.terminal.rows - MODAL_FIXED_ROWS)),
      sectionedSelectListTheme(this.theme),
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

    const breadcrumb = this.levels.map(({ title }) => title).join("  ›  ");
    this.setFrame(
      breadcrumb,
      [level.input, new Spacer(1), level.list],
      "  ↑↓ navigate · Enter select · Esc back or close",
    );
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

function themeItems(ctx: ExtensionContext): PaletteItem[] {
  return ctx.ui.getAllThemes().map(({ name }) => ({
    id: `theme:${name}`,
    label: name,
    description: "Apply theme",
    action: () => {
      const result = ctx.ui.setTheme(name);
      if (result.success === false) {
        ctx.ui.notify(result.error ?? `Could not apply ${name}`, "warning");
      }
    },
  }));
}

function commandItems(ctx: ExtensionContext, pi: ExtensionAPI): PaletteItem[] {
  return pi.getCommands().map((command) => ({
    id: `command:${command.name}`,
    label: `/${command.name}`,
    description: command.description ?? command.source,
    action: () => ctx.ui.setEditorText(`/${command.name} `),
  }));
}

function contextViewItems(pi: ExtensionAPI): PaletteItem[] {
  return [
    {
      id: "context:usage",
      label: "Context Usage",
      description: "Visualize context and token usage",
      action: () => {
        pi.sendUserMessage("/context usage", { expandPromptTemplates: true });
      },
    },
    {
      id: "context:injections",
      label: "Context Injections",
      description: "Inspect prompts, tools, and extension injections",
      action: () => {
        pi.sendUserMessage("/context injections", { expandPromptTemplates: true });
      },
    },
  ];
}

function hasContextView(pi: ExtensionAPI): boolean {
  return pi
    .getCommands()
    .some((command) => command.name === "context" && command.source === "extension");
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

export function rootSections(ctx: ExtensionContext, pi: ExtensionAPI): PaletteSection[] {
  const switchModel: PaletteItem = {
    id: "model",
    label: "Switch Model",
    description: "Choose from available models",
    children: () => modelItems(ctx, pi),
  };
  const session: PaletteItem[] = [
    {
      id: "compact",
      label: "Compact Session",
      description: "Compact the current context",
      action: () => ctx.compact(),
    },
    {
      id: "session-info",
      label: "Session Info",
      description: "Show the current session name and ID",
      action: () => {
        const sessionId = ctx.sessionManager.getSessionId();
        const sessionName = ctx.sessionManager.getSessionName();
        ctx.ui.notify(`${sessionName ?? "Unnamed session"}\n${sessionId}`, "info");
      },
    },
  ];
  let newSession: PaletteItem | undefined;

  if (isCommandContext(ctx)) {
    newSession = {
      id: "new-session",
      label: "New Session",
      description: "Start a fresh session",
      action: async () => {
        await ctx.newSession();
      },
    };
    session.unshift(
      newSession,
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
    session.push({
      id: "reload",
      label: "Reload",
      description: "Reload extensions and configuration",
      action: async () => {
        await ctx.reload();
      },
    });
  }

  const sections: PaletteSection[] = [
    {
      id: "suggested",
      label: "Suggested",
      items: [...(newSession ? [newSession] : []), switchModel],
    },
    { id: "session", label: "Session", items: session },
    {
      id: "model",
      label: "Model",
      items: [
        switchModel,
        {
          id: "thinking",
          label: "Set Thinking Level",
          description: "Change reasoning depth",
          children: () => thinkingItems(ctx, pi),
        },
      ],
    },
    ...(hasContextView(pi)
      ? [
          {
            id: "context",
            label: "Context",
            items: [
              {
                id: "context",
                label: "Inspect Context",
                description: "View context usage and injected instructions",
                children: () => contextViewItems(pi),
              },
            ],
          },
        ]
      : []),
    {
      id: "tools",
      label: "Tools",
      items: [
        {
          id: "tools",
          label: "Toggle Tool",
          description: "Enable or disable a tool",
          children: () => toolItems(pi),
        },
        {
          id: "tool-output",
          label: "Toggle Tool Output",
          description: "Expand or collapse tool results",
          action: () => ctx.ui.setToolsExpanded(ctx.ui.getToolsExpanded() === false),
        },
      ],
    },
    {
      id: "appearance",
      label: "Appearance",
      items: [
        {
          id: "theme",
          label: "Select Theme",
          description: "Switch the active theme",
          children: () => themeItems(ctx),
        },
      ],
    },
    {
      id: "commands",
      label: "Commands",
      items: [
        {
          id: "commands",
          label: "Insert Command",
          description: "Place an available slash command in the prompt",
          children: () => commandItems(ctx, pi),
        },
      ],
    },
  ];

  return sections;
}

export function rootItems(ctx: ExtensionContext, pi: ExtensionAPI): PaletteItem[] {
  const items = rootSections(ctx, pi).flatMap((section) => section.items);
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

async function showPalette(ctx: ExtensionContext, pi: ExtensionAPI) {
  if (ctx.mode !== "tui") return;

  const action = await ctx.ui.custom<PaletteAction | null>(
    (tui, theme, _keybindings, done) => new CommandPalette(tui, theme, rootSections(ctx, pi), done),
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: MODAL_WIDTH,
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
