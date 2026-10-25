import { realpath } from "node:fs/promises";
import type { Usage } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { isMatching, match, P } from "ts-pattern";
import { Type } from "typebox";
import {
  DISCOVERY_FALLBACK_REASONS,
  type DiscoveryFallbackReason,
  DiscoverySearchError,
  MAX_DISCOVERY_CLASSIFIER_CANDIDATES,
  searchCatalog,
} from "../../lib/discovery-ranking";
import { INACTIVE_SPECIALIST_TOOL } from "../../lib/tool-exposure";
import { truncateCommandOutput } from "../just";
import {
  discoverScripts,
  inspectScript,
  isManagedTask,
  rankScriptsLocally,
  type Script,
  type ScriptInspection,
  scriptSearchDescription,
} from "./catalog";
import { registerScript } from "./import-scripts";

const Parameters = Type.Union([
  Type.Object(
    {
      action: Type.Literal("discover"),
      query: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("inspect"), script: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("start"),
      script: Type.String(),
      arguments: Type.Optional(Type.Array(Type.String(), { maxItems: 100 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("status"), task: Type.Optional(Type.String()) },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("output"), task: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("stop"), task: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("restart"), task: Type.String() },
    { additionalProperties: false },
  ),
]);

const TaskPattern = {
  id: P.number,
  path: P.string,
  state: P.string,
  exit_code: P.optional(P.number),
  signal: P.optional(P.number),
  reason: P.optional(P.string),
};
type Task = {
  id: number;
  path: string;
  state: string;
  exit_code?: number;
  signal?: number;
  reason?: string;
};
interface Result {
  action: string;
  project: string;
  task?: string;
  accepted?: boolean;
  runner?: "absent" | "running";
  scripts?: Array<{ id: string; description: string; parameters: string[]; tags: string[] }>;
  script?: ScriptInspection;
  totalScripts?: number;
  considered?: number;
  hasMore?: boolean;
  rankingSource?: "classifier" | "lexical";
  fallbackReason?: DiscoveryFallbackReason;
  tasks?: Task[];
  screen?: string;
  truncated?: boolean;
  warnings?: string[];
}
const Output = Type.Object({
  action: Type.String(),
  project: Type.String(),
  task: Type.Optional(Type.String()),
  accepted: Type.Optional(Type.Boolean()),
  runner: Type.Optional(Type.String()),
  totalScripts: Type.Optional(Type.Integer({ minimum: 0 })),
  considered: Type.Optional(Type.Integer({ minimum: 0 })),
  hasMore: Type.Optional(Type.Boolean()),
  rankingSource: Type.Optional(Type.Union([Type.Literal("classifier"), Type.Literal("lexical")])),
  fallbackReason: Type.Optional(
    Type.Union(DISCOVERY_FALLBACK_REASONS.map((reason) => Type.Literal(reason))),
  ),
  scripts: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.String(),
        description: Type.String(),
        parameters: Type.Array(Type.String()),
        tags: Type.Array(Type.String()),
      }),
    ),
  ),
  warnings: Type.Optional(Type.Array(Type.String())),
  script: Type.Optional(
    Type.Object({
      id: Type.String(),
      source: Type.Union([Type.Literal("just"), Type.Literal("package"), Type.Literal("devenv")]),
      description: Type.String(),
      tags: Type.Array(Type.String()),
      parameters: Type.Union([
        Type.Array(
          Type.Object({
            name: Type.String(),
            kind: Type.Union([
              Type.Literal("singular"),
              Type.Literal("star"),
              Type.Literal("plus"),
            ]),
            required: Type.Boolean(),
            hasDefault: Type.Boolean(),
            flag: Type.Boolean(),
            long: Type.Optional(Type.String()),
            short: Type.Optional(Type.String()),
            multiple: Type.Boolean(),
            help: Type.Optional(Type.String()),
          }),
        ),
        Type.Null(),
      ]),
    }),
  ),
  tasks: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.Number(),
        path: Type.String(),
        state: Type.String(),
        exit_code: Type.Optional(Type.Number()),
        signal: Type.Optional(Type.Number()),
        reason: Type.Optional(Type.String()),
      }),
    ),
  ),
  screen: Type.Optional(Type.String()),
  truncated: Type.Optional(Type.Boolean()),
});

function requireTrust(ctx: ExtensionContext): void {
  if (ctx.isProjectTrusted() !== true) throw new Error("Dekit tools require a trusted project");
}
function requireTask(path: string): void {
  if (!isManagedTask(path))
    throw new Error(
      "Use an exact managed task path returned by dekit; globs, tags, and other runners are not allowed",
    );
}

function scriptSummary(script: Script) {
  return {
    id: script.id,
    description: scriptSearchDescription(script),
    parameters: script.recipe?.parameters.map((parameter) => parameter.name) ?? [],
    tags: script.recipe?.groups ?? [],
  };
}

export default function dekitExtension(pi: ExtensionAPI): void {
  pi.registerTool(
    defineTool<typeof Parameters, Result>({
      ...INACTIVE_SPECIALIST_TOOL,
      name: "dekit",
      label: "Project scripts",
      parameters: Parameters,
      outputSchema: Output,
      description:
        "Discover and inspect public Just recipes, package.json scripts, and devenv tasks, then start and manage them as project-scoped dekit tasks. Actions: discover, inspect, start, status, output, stop, restart. Use a canonical script ID for inspect/start and an exact returned task path for task actions. Inspection returns Just parameter metadata; package/devenv parameters are unknown. Starting and restarting public scripts do not require confirmation; stopping tasks does. Start/restart acknowledgements are not completion; inspect status for state and exit_code. Output is the current terminal screen, not a complete log.",
      promptSnippet: "Discover project scripts and manage them as dekit tasks",
      promptGuidelines: [
        "Use dekit discover before recreating a project workflow with shell commands.",
        "Use dekit inspect with a canonical script ID before constructing Just arguments; package/devenv parameters are unknown, not an empty signature.",
        "Query dekit discover by intent (e.g. 'run unit tests') or tags from Just groups (e.g. 'validation').",
        "A query matching a canonical script ID resolves that script locally without classification.",
        "Omit query or leave it blank to browse scripts locally without calling the classifier; limit bounds the displayed list.",
        "The classifier returns one best script or no match from a bounded pool; it is not exhaustive. Refine query or browse without query for alternatives, even when hasMore is false.",
        "A task-control acknowledgement is not script completion. Use dekit status to check state and exit_code; output returns only the current terminal screen.",
      ],
      executionMode: "sequential",
      async execute(_id, params, signal, _update, ctx) {
        requireTrust(ctx);
        signal?.throwIfAborted();
        const project = await realpath(ctx.cwd);
        async function cli<T>(args: string[], decode: (value: unknown) => T): Promise<T> {
          signal?.throwIfAborted();
          const result = await pi.exec("dekit", ["-C", project, "--json", ...args], {
            cwd: project,
            timeout: 10_000,
            ...(signal === undefined ? {} : { signal }),
          });
          if (result.killed || result.code !== 0) {
            throw new Error(
              `dekit ${args[0]} failed: ${truncateCommandOutput(result.stderr).text}`,
            );
          }
          try {
            return decode(JSON.parse(result.stdout));
          } catch (error) {
            throw new Error(`Invalid dekit ${args[0]} response`, { cause: error });
          }
        }
        async function runner(): Promise<"absent" | "running"> {
          return cli(["runner", "status"], (value) => {
            if (isMatching({ status: "absent" }, value)) return "absent";
            if (isMatching({ status: "running", root: project, kind: "project" }, value))
              return "running";
            throw new Error("Unexpected project runner status");
          });
        }
        async function tasks(path?: string): Promise<Task[]> {
          return cli(["ls", ...(path === undefined ? [] : [path])], (value) => {
            if (!isMatching({ tasks: P.array(TaskPattern) }, value))
              throw new Error("Invalid task list");
            return value.tasks
              .filter((task) => isManagedTask(task.path))
              .map((task) => ({
                id: task.id,
                path: task.path,
                state: task.state,
                ...(task.exit_code === undefined ? {} : { exit_code: task.exit_code }),
                ...(task.signal === undefined ? {} : { signal: task.signal }),
                ...(task.reason === undefined ? {} : { reason: task.reason }),
              }));
          });
        }
        async function confirm(action: string, detail: string): Promise<void> {
          if (ctx.hasUI !== true)
            throw new Error("Dekit task changes require interactive confirmation");
          if (
            !(await ctx.ui.confirm(
              `${action} task?`,
              `Project: ${project}\n${detail}\nStarting a missing runner also loads its dekit.yaml.`,
              signal === undefined ? {} : { signal },
            ))
          )
            throw new Error("Dekit task change declined");
          requireTrust(ctx);
          signal?.throwIfAborted();
          if ((await realpath(ctx.cwd)) !== project)
            throw new Error("Project changed during confirmation");
        }
        async function accept(args: string[]): Promise<void> {
          await cli(args, (value) => {
            if (!isMatching({ matched: 1 }, value))
              throw new Error("Expected exactly one affected task");
          });
        }
        async function control(action: "stop" | "restart", path: string): Promise<Result> {
          requireTask(path);
          if ((await runner()) !== "running") throw new Error("Project runner is not running");
          const before = await tasks(path);
          if (before.length !== 1 || before[0]?.path !== path)
            throw new Error("Task is not present in this project");
          if (action === "stop") await confirm("Stop", `Task: ${path}`);
          const after = await tasks(path);
          if (after.length !== 1 || after[0]?.id !== before[0]?.id || after[0]?.path !== path) {
            throw new Error(
              action === "stop"
                ? "Task changed during confirmation"
                : "Task changed before restart",
            );
          }
          await accept([action, path]);
          return { action, project, task: path, accepted: true };
        }
        let discoveryWarnings: string[] = [];
        const loadCatalog = async () => {
          const catalog = await discoverScripts(pi, project, signal);
          discoveryWarnings = catalog.warnings;
          return catalog.scripts;
        };
        let discoveryUsage: Usage | undefined;
        let discoveryError: string | undefined;
        const data = await match(params)
          .returnType<Promise<Result>>()
          .with({ action: "discover" }, async ({ query, limit }) => {
            const catalog = await loadCatalog();
            signal?.throwIfAborted();
            const byId = new Map(catalog.map((script) => [script.id, script]));
            if (byId.size !== catalog.length)
              throw new Error("Duplicate discovery candidate names");
            const exact = byId.get(query ?? "") ?? byId.get(query?.trim() ?? "");
            if (exact !== undefined) {
              return {
                action: "discover",
                project,
                scripts: [scriptSummary(exact)],
                totalScripts: catalog.length,
                considered: catalog.length,
                hasMore: false,
                rankingSource: "lexical",
              };
            }
            const lexical = rankScriptsLocally(catalog, query ?? "");
            try {
              const ranked = await searchCatalog(catalog, {
                key: (script) => script.id,
                describe: scriptSearchDescription,
                tags: (script) => script.recipe?.groups ?? [],
                lexical,
                query: query ?? "",
                limit: limit ?? 20,
                context: ctx,
                ...(signal === undefined ? {} : { signal }),
              });
              const scripts = ranked.items.map(scriptSummary);
              discoveryUsage = ranked.usage;
              return {
                action: "discover",
                project,
                scripts,
                totalScripts: catalog.length,
                considered:
                  ranked.rankingSource === "classifier"
                    ? Math.min(catalog.length, MAX_DISCOVERY_CLASSIFIER_CANDIDATES)
                    : catalog.length,
                hasMore:
                  ranked.rankingSource === "classifier"
                    ? catalog.length > MAX_DISCOVERY_CLASSIFIER_CANDIDATES
                    : lexical.length > scripts.length,
                rankingSource: ranked.rankingSource,
                ...(ranked.fallbackReason === undefined
                  ? {}
                  : { fallbackReason: ranked.fallbackReason }),
              };
            } catch (error) {
              if (!(error instanceof DiscoverySearchError)) throw error;
              discoveryUsage = error.usage;
              discoveryError = error.message;
              return {
                action: "discover",
                project,
                scripts: [],
                totalScripts: catalog.length,
                considered: Math.min(catalog.length, MAX_DISCOVERY_CLASSIFIER_CANDIDATES),
                hasMore: catalog.length > MAX_DISCOVERY_CLASSIFIER_CANDIDATES,
                rankingSource: "classifier",
              };
            }
          })
          .with({ action: "inspect" }, async ({ script: id }) => {
            const catalog = await loadCatalog();
            signal?.throwIfAborted();
            const script = catalog.find((candidate) => candidate.id === id);
            if (script === undefined)
              throw new Error(
                ["Script is no longer public or does not exist", ...discoveryWarnings].join("\n"),
              );
            return { action: "inspect", project, script: inspectScript(script) };
          })
          .with({ action: "start" }, async ({ script: id, arguments: args = [] }) => {
            if (args.some((arg) => arg.includes("\0")))
              throw new Error("Arguments cannot contain NUL bytes");
            const catalog = await loadCatalog();
            const script = catalog.find((candidate) => candidate.id === id);
            if (script === undefined)
              throw new Error(
                ["Script is no longer public or does not exist", ...discoveryWarnings].join("\n"),
              );
            const path = await registerScript(pi, project, script, {
              arguments: args,
              start: true,
              ...(signal === undefined ? {} : { signal }),
            });
            return { action: "start", project, task: path, accepted: true };
          })
          .with({ action: "status" }, async ({ task }) => {
            if (task !== undefined) requireTask(task);
            const state = await runner();
            return {
              action: "status",
              project,
              runner: state,
              tasks: state === "absent" ? [] : await tasks(task),
            };
          })
          .with({ action: "output" }, async ({ task }) => {
            requireTask(task);
            if ((await runner()) !== "running") throw new Error("Project runner is not running");
            const listed = await tasks(task);
            if (listed.length !== 1 || listed[0]?.path !== task)
              throw new Error("Task is not present in this project");
            const screen = await cli(["screen", task], (value) => {
              if (!isMatching({ screen: P.string }, value))
                throw new Error("Invalid screen response");
              return value.screen;
            });
            const bounded = truncateCommandOutput(screen);
            return {
              action: "output",
              project,
              task,
              screen: bounded.text,
              truncated: bounded.truncated,
            };
          })
          .with({ action: "stop" }, ({ task }) => control("stop", task))
          .with({ action: "restart" }, ({ task }) => control("restart", task))
          .exhaustive();
        if (discoveryWarnings.length > 0) data.warnings = discoveryWarnings;
        const text =
          discoveryError ??
          match(data)
            .with(
              {
                action: "discover",
                scripts: P.array({ id: P.string, description: P.string, tags: P.array(P.string) }),
                totalScripts: P.number,
                considered: P.number,
                hasMore: P.boolean,
                rankingSource: P.union("classifier", "lexical"),
              },
              (discovery) => {
                const mode =
                  discovery.rankingSource === "classifier" ? "classifier one-best" : "local";
                const fallback =
                  discovery.fallbackReason === undefined
                    ? ""
                    : `; fallback: ${discovery.fallbackReason}`;
                const header = `${discovery.scripts.length} scripts shown (${mode}; ${discovery.considered}/${discovery.totalScripts} considered${discovery.hasMore ? "; more available" : ""}${fallback})`;
                return [
                  header,
                  ...discovery.scripts.map(
                    (script) =>
                      `${script.id} — ${script.description}${script.tags.length ? ` [tags: ${JSON.stringify(script.tags)}]` : ""}`,
                  ),
                ].join("\n");
              },
            )
            .otherwise(() => JSON.stringify(data));
        return {
          ...(discoveryUsage === undefined ? {} : { usage: discoveryUsage }),
          ...(discoveryError === undefined ? {} : { isError: true }),
          content: [{ type: "text", text: [text, ...discoveryWarnings].join("\n") }],
          details: data,
          structuredContent: { ...data },
        };
      },
    }),
  );
}
