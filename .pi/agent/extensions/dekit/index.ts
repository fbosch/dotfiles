import { realpath } from "node:fs/promises";
import type { Usage } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { isMatching, match, P } from "ts-pattern";
import { Type } from "typebox";
import { MAX_DISCOVERY_CLASSIFIER_CANDIDATES, rankDiscovery } from "../../lib/discovery-ranking";
import { truncateCommandOutput } from "../just";
import { resolveClassifierToolDiscoveryConfig } from "../tool-discovery";
import {
  discoverScripts,
  isManagedTask,
  rankScriptsLocally,
  scriptCommand,
  scriptSearchDescription,
  taskPath,
} from "./catalog";

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
  totalScripts?: number;
  considered?: number;
  hasMore?: boolean;
  rankingSource?: "classifier" | "lexical";
  tasks?: Task[];
  screen?: string;
  truncated?: boolean;
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
      "Use an exact Pi task path returned by dekit; globs, tags, and other runners are not allowed",
    );
}

export default function dekitExtension(pi: ExtensionAPI): void {
  pi.registerTool(
    defineTool<typeof Parameters, Result>({
      name: "dekit",
      label: "Project scripts",
      parameters: Parameters,
      outputSchema: Output,
      description:
        "Discover public Just recipes and package.json scripts, then start and manage them as project-scoped dekit tasks. Actions: discover, start, status, output, stop, restart. Use the returned script id to start and the exact task path for other actions. Mutations require confirmation. Start/restart acknowledgements are not completion; inspect status for state and exit_code. Output is the current terminal screen, not a complete log.",
      promptSnippet: "Discover project scripts and manage them as dekit tasks",
      promptGuidelines: [
        "Use dekit discover before recreating a project workflow with shell commands.",
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
          await confirm(action === "stop" ? "Stop" : "Restart", `Task: ${path}`);
          const after = await tasks(path);
          if (after.length !== 1 || after[0]?.id !== before[0]?.id || after[0]?.path !== path) {
            throw new Error("Task changed during confirmation");
          }
          await accept([action, path]);
          return { action, project, task: path, accepted: true };
        }
        let discoveryUsage: Usage | undefined;
        let discoveryError: string | undefined;
        const data = await match(params)
          .returnType<Promise<Result>>()
          .with({ action: "discover" }, async ({ query, limit }) => {
            const catalog = await discoverScripts(pi, project, signal);
            const candidates = catalog.map((script) => ({
              name: script.id,
              description: scriptSearchDescription(script),
              tags: script.recipe?.groups ?? [],
            }));
            const lexical = rankScriptsLocally(catalog, query ?? "");
            const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
              projectTrusted: ctx.isProjectTrusted(),
            });
            const config = resolveClassifierToolDiscoveryConfig(
              settings.getGlobalSettings(),
              settings.getProjectSettings(),
            );
            let inferenceUsage: Usage | undefined;
            try {
              const ranked = await rankDiscovery(candidates, lexical, query ?? "", limit ?? 20, {
                modelRegistry: ctx.modelRegistry,
                enabled: config.enabled,
                timeoutMs: config.timeoutMs,
                settingsContext: ctx,
                ...(signal === undefined ? {} : { signal }),
                onUsage: (usage) => {
                  inferenceUsage = usage;
                },
              });
              signal?.throwIfAborted();
              const byId = new Map(catalog.map((script) => [script.id, script]));
              const scripts = ranked.matches.map(({ name }) => {
                const script = byId.get(name);
                if (script === undefined) throw new Error("Ranked script is outside the catalog");
                return {
                  id: script.id,
                  description: scriptSearchDescription(script),
                  parameters: script.recipe?.parameters.map((parameter) => parameter.name) ?? [],
                  tags: script.recipe?.groups ?? [],
                };
              });
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
              };
            } catch (error) {
              if (inferenceUsage === undefined) throw error;
              // Throwing a billed failure would make agent-core discard its inference usage.
              discoveryUsage = inferenceUsage;
              discoveryError = error instanceof Error ? error.message : String(error);
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
          .with({ action: "start" }, async ({ script: id, arguments: args = [] }) => {
            if (args.some((arg) => arg.includes("\0")))
              throw new Error("Arguments cannot contain NUL bytes");
            const catalog = await discoverScripts(pi, project, signal);
            const script = catalog.find((candidate) => candidate.id === id);
            if (script === undefined)
              throw new Error("Script is no longer public or does not exist");
            const command = scriptCommand(script, args);
            const path = taskPath(script, command);
            const existing = (await runner()) === "running" ? await tasks(path) : [];
            // Never reuse a task whose actual command cannot be verified from the CLI task list.
            if (existing.length !== 0)
              throw new Error(`Task already exists: ${path}. Use status, stop, or restart.`);
            await confirm(
              "Start",
              `Script: ${id}\nDescription: ${script.description.slice(0, 500)}\nTask: ${path}\nCommand arguments: ${JSON.stringify(command)}`,
            );
            const fresh = (await discoverScripts(pi, project, signal)).find(
              (candidate) => candidate.id === id,
            );
            if (fresh === undefined || JSON.stringify(fresh) !== JSON.stringify(script)) {
              throw new Error("Script changed during confirmation; discover it again");
            }
            if ((await runner()) === "running" && (await tasks(path)).length !== 0) {
              throw new Error("Task appeared during confirmation");
            }
            await accept(["spawn", path, "--cwd", project, "--", ...command]);
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
                const header = `${discovery.scripts.length} scripts shown (${mode}; ${discovery.considered}/${discovery.totalScripts} considered${discovery.hasMore ? "; more available" : ""})`;
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
          content: [{ type: "text", text }],
          details: data,
          structuredContent: { ...data },
        };
      },
    }),
  );
}
