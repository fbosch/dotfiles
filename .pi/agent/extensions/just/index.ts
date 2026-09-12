import { spawn } from "node:child_process";
import {
  defineTool,
  type ExecResult,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { type AutocompleteItem, matchesKey } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { runAskUserQuestion } from "../ask-user-question";
import {
  allocateRecipeToolName,
  buildRecipeArguments,
  createRecipeParametersSchema,
  type JustRecipe,
  parseJustCatalog,
  recipeSignature,
  recipeToolDescription,
  searchRecipes,
} from "./catalog";
import { JustOutputModal, type RecipeOutputHandler } from "./output-modal";

const DISCOVERY_TIMEOUT_MS = 10_000;
const RECIPE_TIMEOUT_MS = 10 * 60_000;
const MAX_MATCHES = 10;
const DEFAULT_MATCHES = 5;
const MAX_STREAM_BYTES = 22_000;
const MAX_STREAM_LINES = 1_000;
const TERMINATION_GRACE_MS = 2_000;
const POST_EXIT_OUTPUT_GRACE_MS = 250;

const JustToolsParameters = Type.Object(
  {
    query: Type.Optional(
      Type.String({
        description: "Recipe name, group, or capability to search for. Omit to list recipes.",
      }),
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_MATCHES })),
  },
  { additionalProperties: false },
);

interface RegisteredRecipe {
  recipeName: string;
  signature: string;
  toolName: string;
}

interface JustToolsDetails {
  matches: string[];
  added: string[];
  reloadRequired: string[];
}

interface JustRecipeDetails {
  recipe: string;
  arguments: string[];
  exitCode: number;
  killed: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

interface TruncatedOutput {
  text: string;
  truncated: boolean;
}

export interface RecipeExecutionResult extends ExecResult {
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export type RecipeExecutor = (
  cwd: string,
  arguments_: string[],
  signal?: AbortSignal,
  onOutput?: RecipeOutputHandler,
) => Promise<RecipeExecutionResult>;

class OutputTail {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  truncated = false;

  append(value: Buffer): void {
    if (
      value.length > MAX_STREAM_BYTES ||
      (value.length === MAX_STREAM_BYTES && this.buffer.length > 0)
    ) {
      this.buffer = value.subarray(value.length - MAX_STREAM_BYTES);
      this.truncated = true;
      return;
    }

    const combined = Buffer.concat([this.buffer, value]);
    if (combined.length <= MAX_STREAM_BYTES) {
      this.buffer = combined;
      return;
    }

    this.buffer = combined.subarray(combined.length - MAX_STREAM_BYTES);
    this.truncated = true;
  }

  text(): string {
    let start = 0;
    while (start < this.buffer.length && (this.buffer[start] ?? 0) >> 6 === 2) start += 1;
    return this.buffer.subarray(start).toString("utf8");
  }
}

function noJustfile(stderr: string): boolean {
  return /no justfile found/i.test(stderr);
}

function commandError(prefix: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${prefix}: ${message}`);
}

export async function discoverJustRecipes(
  pi: Pick<ExtensionAPI, "exec">,
  cwd: string,
  signal?: AbortSignal,
): Promise<JustRecipe[]> {
  let result: ExecResult;
  try {
    result = await pi.exec("just", ["--no-dotenv", "--json"], {
      cwd,
      timeout: DISCOVERY_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    throw commandError("Could not inspect Just recipes", error);
  }

  if (result.code !== 0) {
    if (noJustfile(result.stderr)) return [];
    const detail = result.stderr.trim() || `just exited with code ${result.code}`;
    throw new Error(`Could not inspect Just recipes: ${detail}`);
  }

  try {
    return parseJustCatalog(JSON.parse(result.stdout));
  } catch (error) {
    throw commandError("Could not parse `just --json` output", error);
  }
}

function sliceUtf8Tail(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) return value;

  let start = buffer.length - maxBytes;
  while (start < buffer.length && (buffer[start] ?? 0) >> 6 === 2) start += 1;
  return buffer.subarray(start).toString("utf8");
}

export function truncateCommandOutput(value: string): TruncatedOutput {
  const lines = value.split("\n");
  const lineTruncated = lines.length > MAX_STREAM_LINES;
  const lineBounded = lineTruncated ? lines.slice(-MAX_STREAM_LINES).join("\n") : value;
  const byteTruncated = Buffer.byteLength(lineBounded, "utf8") > MAX_STREAM_BYTES;
  const text = byteTruncated ? sliceUtf8Tail(lineBounded, MAX_STREAM_BYTES) : lineBounded;
  return {
    text: lineTruncated || byteTruncated ? `[Earlier output truncated]\n${text}` : text,
    truncated: lineTruncated || byteTruncated,
  };
}

function formatOutput(
  stdoutValue: string,
  stderrValue: string,
  stdoutWasTruncated: boolean,
  stderrWasTruncated: boolean,
): {
  text: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
} {
  const stdout = truncateCommandOutput(stdoutValue);
  const stderr = truncateCommandOutput(stderrValue);
  const stdoutText =
    stdoutWasTruncated && stdout.truncated === false
      ? `[Earlier output truncated]\n${stdout.text}`
      : stdout.text;
  const stderrText =
    stderrWasTruncated && stderr.truncated === false
      ? `[Earlier output truncated]\n${stderr.text}`
      : stderr.text;
  const sections: string[] = [];
  if (stdoutText.length > 0) sections.push(`stdout:\n${stdoutText}`);
  if (stderrText.length > 0) sections.push(`stderr:\n${stderrText}`);
  return {
    text: sections.join("\n\n") || "Recipe completed with no output.",
    stdoutTruncated: stdoutWasTruncated || stdout.truncated,
    stderrTruncated: stderrWasTruncated || stderr.truncated,
  };
}
function formatResult(result: RecipeExecutionResult): ReturnType<typeof formatOutput> {
  return formatOutput(result.stdout, result.stderr, result.stdoutTruncated, result.stderrTruncated);
}

export async function executeJustRecipe(
  cwd: string,
  arguments_: string[],
  signal?: AbortSignal,
  onOutput?: RecipeOutputHandler,
): Promise<RecipeExecutionResult> {
  if (signal?.aborted === true) throw new Error("Just recipe execution was cancelled");

  return new Promise((resolve, reject) => {
    const stdout = new OutputTail();
    const stderr = new OutputTail();
    const ownsProcessGroup = process.platform !== "win32";
    const child = spawn("just", arguments_, {
      cwd,
      detached: ownsProcessGroup,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let killed = false;
    let timedOut = false;
    let exitCode: number | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let forceSettleTimer: NodeJS.Timeout | undefined;
    let outputGraceTimer: NodeJS.Timeout | undefined;

    const publishOutput = (): void => {
      if (onOutput === undefined) return;
      onOutput(formatOutput(stdout.text(), stderr.text(), stdout.truncated, stderr.truncated));
    };
    const timeout = setTimeout(() => terminate("timeout"), RECIPE_TIMEOUT_MS);
    timeout.unref();

    function cleanup(): void {
      clearTimeout(timeout);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      if (forceSettleTimer !== undefined) clearTimeout(forceSettleTimer);
      if (outputGraceTimer !== undefined) clearTimeout(outputGraceTimer);
      signal?.removeEventListener("abort", abort);
    }

    function signalProcess(signalName: NodeJS.Signals): void {
      if (child.pid === undefined) return;
      try {
        if (ownsProcessGroup) process.kill(-child.pid, signalName);
        else child.kill(signalName);
      } catch {
        try {
          child.kill(signalName);
        } catch {
          // The process exited between the state check and signal delivery.
        }
      }
    }

    function settle(code = exitCode ?? 1): void {
      if (settled) return;
      settled = true;
      cleanup();
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({
        stdout: stdout.text(),
        stderr: stderr.text(),
        code,
        killed,
        timedOut,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
      });
    }

    function terminate(reason: "cancelled" | "timeout"): void {
      if (killed) return;
      killed = true;
      timedOut = reason === "timeout";
      signalProcess("SIGTERM");
      forceKillTimer = setTimeout(() => signalProcess("SIGKILL"), TERMINATION_GRACE_MS);
      forceKillTimer.unref();
      forceSettleTimer = setTimeout(
        () => settle(),
        TERMINATION_GRACE_MS + POST_EXIT_OUTPUT_GRACE_MS,
      );
      forceSettleTimer.unref();
    }

    function abort(): void {
      terminate("cancelled");
    }

    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout.append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      publishOutput();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr.append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      publishOutput();
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(commandError("Could not run Just recipe", error));
    });
    child.once("exit", (code) => {
      exitCode = code ?? 1;
      if (killed) return;

      // A background descendant may retain the inherited pipes after Just exits.
      outputGraceTimer = setTimeout(() => settle(), POST_EXIT_OUTPUT_GRACE_MS);
      outputGraceTimer.unref();
    });
    child.once("close", (code) => {
      if (settled) return;
      exitCode = code ?? exitCode ?? 1;
      if (killed) signalProcess("SIGKILL");
      settle(exitCode);
    });
  });
}

function confirmationMessage(recipe: JustRecipe, arguments_: string[], cwd: string): string {
  const renderedArguments = arguments_.length > 0 ? JSON.stringify(arguments_) : "none";
  return [
    `Recipe: ${recipe.namepath}`,
    `Arguments: ${renderedArguments}`,
    `Directory: ${cwd}`,
    "",
    recipe.doc,
  ].join("\n");
}

function trustedProject(ctx: ExtensionContext): void {
  if (ctx.isProjectTrusted() === false) {
    throw new Error("Just recipe tools are unavailable until the project is trusted");
  }
}
const MAX_COMMAND_MATCHES = 20;

export function recipeCompletionDescription(recipe: JustRecipe): string {
  const group = recipe.groups.length > 0 ? `Group: ${recipe.groups.join(", ")}.` : undefined;
  const parameters =
    recipe.parameters.length > 0
      ? `Arguments: ${recipe.parameters.map((parameter) => parameter.name).join(" ")}.`
      : undefined;
  return [recipe.doc, group, parameters]
    .filter((part): part is string => part !== undefined)
    .join(" ");
}

export function justRecipeCompletions(
  recipes: JustRecipe[],
  prefix: string,
  limit = MAX_COMMAND_MATCHES,
): AutocompleteItem[] | null {
  if (/\s/u.test(prefix)) return null;
  const query = prefix.trim();
  const matches =
    query.length === 0 ? recipes.slice(0, limit) : searchRecipes(recipes, query, limit);
  if (matches.length === 0) return null;

  return matches.map((recipe) => ({
    value: recipe.namepath,
    label: recipe.namepath,
    description: recipeCompletionDescription(recipe),
  }));
}

export function parseJustCommandArguments(input: string): string[] {
  const arguments_: string[] = [];
  const characters = [...input];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;
  let tokenStarted = false;

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === undefined) continue;

    if (escaping) {
      current += character;
      escaping = false;
      tokenStarted = true;
      continue;
    }

    if (quote === "'") {
      if (character === "'") quote = undefined;
      else current += character;
      continue;
    }

    if (quote === '"') {
      if (character === '"') {
        quote = undefined;
      } else if (character === "\\") {
        const nextCharacter = characters[index + 1];
        if (
          nextCharacter === '"' ||
          nextCharacter === "\\" ||
          nextCharacter === "$" ||
          nextCharacter === "`"
        ) {
          escaping = true;
        } else {
          current += character;
        }
      } else {
        current += character;
      }
      continue;
    }

    if (/\s/u.test(character)) {
      if (tokenStarted) {
        arguments_.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }
    if (character === "'") {
      quote = "'";
      tokenStarted = true;
      continue;
    }
    if (character === '"') {
      quote = '"';
      tokenStarted = true;
      continue;
    }
    if (character === "\\") {
      escaping = true;
      tokenStarted = true;
      continue;
    }

    current += character;
    tokenStarted = true;
  }

  if (escaping) throw new Error("Invalid /just arguments: trailing escape");
  if (quote !== undefined) throw new Error("Invalid /just arguments: unterminated quote");
  if (tokenStarted) arguments_.push(current);
  return arguments_;
}

function makeRecipeCache(cwd: string): {
  cwd: string;
  promise: Promise<JustRecipe[]> | undefined;
} {
  return { cwd, promise: undefined };
}

export function registerJustTools(
  pi: ExtensionAPI,
  recipeExecutor: RecipeExecutor = executeJustRecipe,
): void {
  const registeredRecipes = new Map<string, RegisteredRecipe>();

  function registerRecipeTool(recipe: JustRecipe): RegisteredRecipe {
    const existing = registeredRecipes.get(recipe.namepath);
    if (existing !== undefined) return existing;

    const usedNames = new Set(pi.getAllTools().map((tool) => tool.name));
    const toolName = allocateRecipeToolName(recipe.namepath, usedNames);
    const signature = recipeSignature(recipe);
    const recipeParameters = createRecipeParametersSchema(recipe);

    pi.registerTool(
      defineTool<typeof recipeParameters, JustRecipeDetails>({
        name: toolName,
        label: `just ${recipe.namepath}`,
        description: recipeToolDescription(recipe),
        parameters: recipeParameters,
        executionMode: "sequential",

        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
          trustedProject(ctx);
          const currentRecipes = await discoverJustRecipes(pi, ctx.cwd, signal);
          const currentRecipe = currentRecipes.find(
            (candidate) => candidate.namepath === recipe.namepath,
          );
          if (currentRecipe === undefined) {
            throw new Error(
              `Just recipe \`${recipe.namepath}\` is no longer public or no longer exists`,
            );
          }
          if (recipeSignature(currentRecipe) !== signature) {
            throw new Error(
              `Just recipe \`${recipe.namepath}\` changed parameters; run \`/reload\` before invoking it`,
            );
          }

          const arguments_ = buildRecipeArguments(currentRecipe, params);
          if (ctx.hasUI === false) {
            throw new Error(`Just recipe \`${recipe.namepath}\` requires interactive confirmation`);
          }

          const confirmation = await runAskUserQuestion(
            {
              question: `Run \`just ${currentRecipe.namepath}\`?`,
              details: confirmationMessage(currentRecipe, arguments_, ctx.cwd),
              options: [
                { label: "Run recipe", value: "yes" },
                { label: "Cancel", value: "no" },
              ],
            },
            signal,
            ctx,
            { includeOther: false },
          );
          if (confirmation.details.status === "cancelled") {
            throw new Error(`Just recipe \`${recipe.namepath}\` was cancelled`);
          }
          if (confirmation.details.status !== "answered") {
            throw new Error(`Just recipe \`${recipe.namepath}\` could not be confirmed`);
          }
          if (confirmation.details.answers[0]?.value !== "yes") {
            throw new Error(`Just recipe \`${recipe.namepath}\` was declined`);
          }

          const confirmedRecipes = await discoverJustRecipes(pi, ctx.cwd, signal);
          const confirmedRecipe = confirmedRecipes.find(
            (candidate) => candidate.namepath === recipe.namepath,
          );
          if (confirmedRecipe === undefined || recipeSignature(confirmedRecipe) !== signature) {
            throw new Error(
              `Just recipe \`${recipe.namepath}\` changed during confirmation; run \`/reload\` before invoking it`,
            );
          }

          const result = await recipeExecutor(
            ctx.cwd,
            ["--yes", "--one", "--", recipe.namepath, ...arguments_],
            signal,
          );
          const formatted = formatResult(result);
          if (result.code !== 0 || result.killed) {
            const reason =
              signal?.aborted === true
                ? "cancelled"
                : result.timedOut
                  ? `timed out after ${RECIPE_TIMEOUT_MS / 1_000} seconds`
                  : `failed with exit code ${result.code}`;
            throw new Error(`Just recipe \`${recipe.namepath}\` ${reason}\n\n${formatted.text}`);
          }

          return {
            content: [{ type: "text", text: formatted.text }],
            details: {
              recipe: recipe.namepath,
              arguments: arguments_,
              exitCode: result.code,
              killed: result.killed,
              stdoutTruncated: formatted.stdoutTruncated,
              stderrTruncated: formatted.stderrTruncated,
            },
          };
        },
      }),
    );

    const registered = { recipeName: recipe.namepath, signature, toolName };
    registeredRecipes.set(recipe.namepath, registered);
    return registered;
  }

  pi.registerTool(
    defineTool<typeof JustToolsParameters, JustToolsDetails>({
      name: "just_tools",
      label: "Just recipes",
      description:
        "Search public Just recipes in the current project and enable matching recipe tools. Recipe doc comments become tool descriptions; private recipes are excluded.",
      promptSnippet: "Discover and enable project Just recipes as tools",
      promptGuidelines: [
        "Use just_tools to discover documented project workflows before reproducing them with shell commands.",
      ],
      parameters: JustToolsParameters,
      executionMode: "sequential",

      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        trustedProject(ctx);
        const recipes = await discoverJustRecipes(pi, ctx.cwd, signal);
        const matches = searchRecipes(recipes, params.query ?? "", params.limit ?? DEFAULT_MATCHES);
        if (matches.length === 0) {
          const suffix = params.query === undefined ? "" : ` matching \`${params.query}\``;
          return {
            content: [{ type: "text", text: `No public Just recipes found${suffix}.` }],
            details: { matches: [], added: [], reloadRequired: [] },
          };
        }

        const activeTools = pi.getActiveTools();
        const added: string[] = [];
        const reloadRequired: string[] = [];
        const lines = matches.map((recipe) => {
          const registered = registerRecipeTool(recipe);
          const groupLabel =
            recipe.groups.length > 0 ? ` [group: ${recipe.groups.join(", ")}]` : "";
          if (registered.signature !== recipeSignature(recipe)) {
            reloadRequired.push(recipe.namepath);
            return `- ${recipe.namepath}${groupLabel}: parameters changed; run /reload`;
          }
          if (!activeTools.includes(registered.toolName)) added.push(registered.toolName);
          return `- ${registered.toolName}${groupLabel}: ${recipe.doc}`;
        });

        if (added.length > 0) pi.setActiveTools([...new Set([...activeTools, ...added])]);
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: {
            matches: matches.map((recipe) => recipe.namepath),
            added,
            reloadRequired,
          },
        };
      },
    }),
  );
}

function recipeForCommand(recipes: JustRecipe[], name: string): JustRecipe | undefined {
  return recipes.find((recipe) => recipe.namepath === name || recipe.aliases.includes(name));
}

function commandFailureMessage(
  recipe: JustRecipe,
  result: RecipeExecutionResult,
  formatted: ReturnType<typeof formatResult>,
  signal: AbortSignal | undefined,
): string {
  const reason =
    signal?.aborted === true
      ? "cancelled"
      : result.timedOut
        ? `timed out after ${RECIPE_TIMEOUT_MS / 1_000} seconds`
        : `failed with exit code ${result.code}`;
  return `Just recipe \`${recipe.namepath}\` ${reason}\n\n${formatted.text}`;
}

export function registerJustCommand(
  pi: ExtensionAPI,
  recipeExecutor: RecipeExecutor = executeJustRecipe,
): void {
  let cache = makeRecipeCache(process.cwd());

  let projectTrustResolved = false;
  let projectTrusted = false;
  const activeCommandControllers = new Set<AbortController>();
  function createCommandSignal(ctx: ExtensionCommandContext): {
    signal: AbortSignal;
    dispose: () => void;
    disableCancellation: () => void;
  } {
    const controller = new AbortController();
    activeCommandControllers.add(controller);
    let terminalCancellationEnabled = true;
    const abortFromParent = () => controller.abort();
    if (ctx.signal?.aborted === true) {
      controller.abort();
    } else {
      ctx.signal?.addEventListener("abort", abortFromParent, { once: true });
    }
    const removeTerminalInputHandler =
      ctx.mode === "tui"
        ? ctx.ui.onTerminalInput((data) => {
            if (terminalCancellationEnabled === false) return undefined;
            if (matchesKey(data, "escape") === false && matchesKey(data, "ctrl+c") === false) {
              return undefined;
            }
            controller.abort();
            return { consume: true };
          })
        : () => {};

    return {
      signal: controller.signal,
      dispose: () => {
        removeTerminalInputHandler();
        ctx.signal?.removeEventListener("abort", abortFromParent);
        activeCommandControllers.delete(controller);
      },
      disableCancellation: () => {
        terminalCancellationEnabled = false;
      },
    };
  }
  function resetCache(cwd: string): void {
    cache = makeRecipeCache(cwd);
  }

  function loadCachedRecipes(cwd: string): Promise<JustRecipe[]> {
    if (cache.cwd !== cwd) resetCache(cwd);
    if (cache.promise === undefined) {
      const discovery = discoverJustRecipes(pi, cwd);
      let cachedPromise: Promise<JustRecipe[]>;
      cachedPromise = discovery.catch((error: unknown) => {
        if (cache.promise === cachedPromise) cache.promise = undefined;
        throw error;
      });
      cache.promise = cachedPromise;
    }
    return cache.promise;
  }

  pi.on("session_start", (_event, ctx) => {
    resetCache(ctx.cwd);
    projectTrustResolved = true;
    projectTrusted = ctx.isProjectTrusted();
    if (!projectTrusted) return;

    void loadCachedRecipes(ctx.cwd).catch((error: unknown) => {
      ctx.ui.notify(
        error instanceof Error ? error.message : `Could not load Just recipes: ${String(error)}`,
        "error",
      );
    });
  });

  pi.on("session_shutdown", () => {
    for (const controller of activeCommandControllers) controller.abort();
  });

  pi.registerCommand("just", {
    description: "Run a public Just recipe from the current project",
    getArgumentCompletions: async (prefix: string) => {
      if (projectTrustResolved === false || projectTrusted === false) return null;
      try {
        const recipes = await loadCachedRecipes(cache.cwd);
        return justRecipeCompletions(recipes, prefix);
      } catch {
        return null;
      }
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const commandExecution = createCommandSignal(ctx);
      const { signal } = commandExecution;
      try {
        trustedProject(ctx);
        const tokens = parseJustCommandArguments(args);
        const recipeName = tokens[0];
        if (recipeName === undefined) {
          ctx.ui.notify("Usage: /just <recipe> [arguments]", "warning");
          return;
        }

        const recipes = await discoverJustRecipes(pi, ctx.cwd, signal);
        const recipe = recipeForCommand(recipes, recipeName);
        if (recipe === undefined) {
          ctx.ui.notify(`No public Just recipe named \`${recipeName}\``, "error");
          return;
        }

        const recipeArguments = ["--yes", "--one", "--", recipe.namepath, ...tokens.slice(1)];
        if (ctx.mode !== "tui") {
          const result = await recipeExecutor(ctx.cwd, recipeArguments, signal);
          const formatted = formatResult(result);
          if (result.code !== 0 || result.killed) {
            ctx.ui.notify(commandFailureMessage(recipe, result, formatted, signal), "error");
            return;
          }
          ctx.ui.notify(
            `Just recipe \`${recipe.namepath}\` completed\n\n${formatted.text}`,
            "info",
          );
          return;
        }

        await ctx.ui.custom<void>(
          (tui, theme, _keybindings, done) => {
            const modal = new JustOutputModal(
              tui,
              theme,
              recipe.namepath,
              tokens.slice(1),
              signal,
              done,
            );
            void Promise.resolve()
              .then(() =>
                recipeExecutor(ctx.cwd, recipeArguments, signal, (output) =>
                  modal.updateOutput(output),
                ),
              )
              .then(
                (result) => {
                  commandExecution.disableCancellation();
                  modal.finish(result, formatResult(result), signal.aborted);
                },
                (error: unknown) => {
                  commandExecution.disableCancellation();
                  modal.fail(error);
                },
              );
            return modal;
          },
          {
            overlay: true,
            overlayOptions: { anchor: "center", width: "85%", maxHeight: "80%", margin: 2 },
          },
        );
      } catch (error: unknown) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      } finally {
        commandExecution.dispose();
      }
    },
  });
}

export default function justExtension(pi: ExtensionAPI): void {
  registerJustTools(pi);
  registerJustCommand(pi);
}
