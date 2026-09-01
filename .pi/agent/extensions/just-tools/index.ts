import { spawn } from "node:child_process";
import {
  defineTool,
  type ExecResult,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
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

function formatResult(result: RecipeExecutionResult): {
  text: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
} {
  const stdout = truncateCommandOutput(result.stdout);
  const stderr = truncateCommandOutput(result.stderr);
  const stdoutText =
    result.stdoutTruncated && stdout.truncated === false
      ? `[Earlier output truncated]\n${stdout.text}`
      : stdout.text;
  const stderrText =
    result.stderrTruncated && stderr.truncated === false
      ? `[Earlier output truncated]\n${stderr.text}`
      : stderr.text;
  const sections: string[] = [];
  if (stdoutText.length > 0) sections.push(`stdout:\n${stdoutText}`);
  if (stderrText.length > 0) sections.push(`stderr:\n${stderrText}`);
  return {
    text: sections.join("\n\n") || "Recipe completed with no output.",
    stdoutTruncated: result.stdoutTruncated || stdout.truncated,
    stderrTruncated: result.stderrTruncated || stderr.truncated,
  };
}

export async function executeJustRecipe(
  cwd: string,
  arguments_: string[],
  signal?: AbortSignal,
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
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr.append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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

          const confirmed = await ctx.ui.confirm(
            "Run Just recipe?",
            confirmationMessage(currentRecipe, arguments_, ctx.cwd),
            signal === undefined ? undefined : { signal },
          );
          if (confirmed === false)
            throw new Error(`Just recipe \`${recipe.namepath}\` was declined`);

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
          if (registered.signature !== recipeSignature(recipe)) {
            reloadRequired.push(recipe.namepath);
            return `- ${recipe.namepath}: parameters changed; run /reload`;
          }
          if (!activeTools.includes(registered.toolName)) added.push(registered.toolName);
          return `- ${registered.toolName}: ${recipe.doc}`;
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

export default function justToolsExtension(pi: ExtensionAPI): void {
  registerJustTools(pi);
}
