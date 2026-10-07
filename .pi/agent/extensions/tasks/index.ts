import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { Static } from "typebox";
import { Type } from "typebox";

export const TASKS_STATE_ENTRY = "fbb.tasks-checklist.snapshot";
export const TASKS_STATE_SCHEMA = "fbb.tasks-checklist/v1";

const STATUSES = ["pending", "in_progress", "completed"] as const;
const StatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("in_progress"),
  Type.Literal("completed"),
]);
const TaskSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, description: "Stable item ID" }),
    title: Type.String({ minLength: 1, description: "Task title" }),
    status: StatusSchema,
  },
  { additionalProperties: false },
);

export const TasksParameters = Type.Object(
  {
    action: Type.Union([Type.Literal("list"), Type.Literal("set"), Type.Literal("update")]),
    items: Type.Optional(Type.Array(TaskSchema, { description: "Complete plan for set" })),
    id: Type.Optional(Type.String({ description: "Existing item ID for update" })),
    title: Type.Optional(Type.String({ description: "Replacement title for update" })),
    status: Type.Optional(StatusSchema),
  },
  { additionalProperties: false },
);

export type TaskItem = Static<typeof TaskSchema>;
export type TasksInput = Static<typeof TasksParameters>;

interface TaskSnapshot {
  schema: typeof TASKS_STATE_SCHEMA;
  items: TaskItem[];
}

interface TaskToolDetails {
  action: TasksInput["action"];
  items: TaskItem[];
}

interface OperationResult extends TaskToolDetails {
  text: string;
  changed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is TaskItem["status"] {
  return STATUSES.some((status) => status === value);
}

function normalizeTask(value: unknown): TaskItem {
  if (!isRecord(value)) throw new Error("Each task must be an object");
  if (typeof value.id !== "string" || value.id.trim() === "") {
    throw new Error("Each task needs a non-empty id");
  }
  if (typeof value.title !== "string" || value.title.trim() === "") {
    throw new Error("Each task needs a non-empty title");
  }
  if (!isStatus(value.status)) throw new Error(`Invalid task status for ${value.id}`);
  return { id: value.id.trim(), title: value.title.trim(), status: value.status };
}

function normalizeTasks(value: unknown): TaskItem[] {
  if (!Array.isArray(value)) throw new Error("set requires an items array");
  const items = value.map(normalizeTask);
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`Duplicate task id: ${item.id}`);
    ids.add(item.id);
  }
  return items;
}

function parseSnapshot(value: unknown): TaskItem[] {
  if (!isRecord(value) || value.schema !== TASKS_STATE_SCHEMA) {
    throw new Error(`Invalid ${TASKS_STATE_ENTRY} entry schema`);
  }
  return normalizeTasks(value.items);
}

function applyOperation(current: readonly TaskItem[], input: TasksInput): OperationResult {
  if (input.action === "list") {
    if (
      input.items !== undefined ||
      input.id !== undefined ||
      input.title !== undefined ||
      input.status !== undefined
    ) {
      throw new Error("list accepts only the action field");
    }
    const items = current.map((item) => ({ ...item }));
    return { action: "list", items, changed: false, text: formatTaskList(items) };
  }

  if (input.action === "set") {
    if (input.id !== undefined || input.title !== undefined || input.status !== undefined) {
      throw new Error("set accepts only action and items");
    }
    const items = normalizeTasks(input.items);
    return {
      action: "set",
      items,
      changed: true,
      text: `Set plan with ${items.length} ${items.length === 1 ? "task" : "tasks"}.`,
    };
  }

  if (input.items !== undefined) throw new Error("update accepts one item, not an items array");
  if (input.id === undefined || input.id.trim() === "")
    throw new Error("update requires an item id");
  if (input.title === undefined && input.status === undefined) {
    throw new Error("update requires a title or status");
  }
  const id = input.id.trim();
  const index = current.findIndex((item) => item.id === id);
  if (index < 0) throw new Error(`Task not found: ${id}`);

  const items = current.map((item, itemIndex) =>
    itemIndex === index
      ? {
          ...item,
          ...(input.title === undefined
            ? {}
            : { title: normalizeTask({ ...item, title: input.title }).title }),
          ...(input.status === undefined ? {} : { status: input.status }),
        }
      : { ...item },
  );
  const updated = items[index];
  if (updated === undefined) throw new Error(`Task not found: ${input.id}`);
  return { action: "update", items, changed: true, text: `Updated task ${updated.id}.` };
}

export function formatTaskList(items: readonly TaskItem[]): string {
  if (items.length === 0) return "No tasks.";
  return items.map(({ id, title, status }) => `#${id} ${title} [${status}]`).join("\n");
}

export function formatProgress(items: readonly TaskItem[]): string {
  if (items.length === 0) return "";
  const completed = items.filter((item) => item.status === "completed").length;
  const active = items.filter((item) => item.status === "in_progress").length;
  return `Tasks ${completed}/${items.length} done${active === 0 ? "" : ` · ${active} in progress`}`;
}

function snapshot(items: readonly TaskItem[]): TaskSnapshot {
  return {
    schema: TASKS_STATE_SCHEMA,
    items: items.map((item) => ({ ...item })),
  };
}

function restoreTasks(ctx: ExtensionContext): TaskItem[] {
  const lastEntry = ctx.sessionManager
    .getBranch()
    .slice()
    .reverse()
    .find((entry) => entry.type === "custom" && entry.customType === TASKS_STATE_ENTRY);
  if (lastEntry === undefined) return [];
  if (lastEntry.type !== "custom") throw new Error(`Invalid ${TASKS_STATE_ENTRY} session entry`);
  return parseSnapshot(lastEntry.data);
}

function renderWidget(items: readonly TaskItem[], ctx: ExtensionContext): void {
  if (!ctx.hasUI || ctx.mode !== "tui") return;
  const progress = formatProgress(items);
  if (progress === "") {
    ctx.ui.setWidget("tasks", undefined);
    return;
  }
  ctx.ui.setWidget("tasks", (_tui, theme) => new Text(theme.fg("muted", progress), 0, 0), {
    placement: "aboveEditor",
  });
}

function taskGlyph(status: TaskItem["status"], theme: Theme): string {
  switch (status) {
    case "pending":
      return theme.fg("dim", "○");
    case "in_progress":
      return theme.fg("accent", "◉");
    case "completed":
      return theme.fg("success", "✓");
    default:
      return theme.fg("dim", "○");
  }
}

class TaskListComponent {
  constructor(
    private readonly items: readonly TaskItem[],
    private readonly theme: Theme,
    private readonly done: () => void,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) this.done();
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines = [
      this.theme.fg("accent", " Tasks "),
      ...(this.items.length === 0
        ? [this.theme.fg("dim", "No tasks yet.")]
        : this.items.map(
            ({ id, title, status }) =>
              `  ${taskGlyph(status, this.theme)} ${this.theme.fg("accent", `#${id}`)} ${
                status === "completed" ? this.theme.fg("dim", title) : this.theme.fg("text", title)
              } ${this.theme.fg("muted", `[${status}]`)}`,
          )),
      this.theme.fg("dim", "Press Escape to close"),
    ];
    return lines.map((line) => truncateToWidth(line, width));
  }
}

export default function tasksExtension(pi: ExtensionAPI): void {
  let items: TaskItem[] = [];

  const persist = (next: TaskItem[], ctx: ExtensionContext): void => {
    pi.appendEntry(TASKS_STATE_ENTRY, snapshot(next));
    items = next;
    renderWidget(items, ctx);
  };

  const restore = (ctx: ExtensionContext): void => {
    let restored: TaskItem[];
    try {
      restored = restoreTasks(ctx);
    } catch (error) {
      items = [];
      renderWidget(items, ctx);
      throw error;
    }
    items = restored;
    renderWidget(items, ctx);
  };

  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    items = [];
    if (ctx.mode === "tui") ctx.ui.setWidget("tasks", undefined);
  });

  pi.registerTool(
    defineTool<typeof TasksParameters, TaskToolDetails>({
      name: "tasks",
      label: "Tasks",
      description:
        "Manage the current checklist: list items, replace the full plan, or update one item by id.",
      promptSnippet: "Track the current request with the task checklist",
      promptGuidelines: [
        "Use tasks only for work in the current request. set replaces the full plan; update changes one existing item.",
        "Use pending, in_progress, or completed. Mark work completed only after verifying it.",
      ],
      parameters: TasksParameters,
      executionMode: "sequential",
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const result = applyOperation(items, params);
        if (result.changed) persist(result.items, ctx);
        return {
          content: [
            {
              type: "text",
              text: result.changed
                ? `${result.text}\n${formatTaskList(result.items)}`
                : result.text,
            },
          ],
          details: { action: result.action, items: result.items.map((item) => ({ ...item })) },
        };
      },
    }),
  );

  pi.registerCommand("tasks", {
    description: "View or clear the current task checklist",
    handler: async (args, ctx) => {
      const action = args.trim() || "view";
      if (action === "clear") {
        persist([], ctx);
        ctx.ui.notify("Task plan cleared", "info");
        return;
      }
      if (action !== "view") {
        ctx.ui.notify("Usage: /tasks [view|clear]", "warning");
        return;
      }
      const currentItems = items.map((item) => ({ ...item }));
      if (ctx.mode === "tui") {
        await ctx.ui.custom<void>(
          (_tui, theme, _keybindings, done) => new TaskListComponent(currentItems, theme, done),
        );
      } else {
        ctx.ui.notify(formatTaskList(currentItems), "info");
      }
    },
  });
}
