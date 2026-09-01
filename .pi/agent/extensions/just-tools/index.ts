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

function formatResult(result: ExecResult): {
  text: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
} {
  const stdout = truncateCommandOutput(result.stdout);
  const stderr = truncateCommandOutput(result.stderr);
  const sections: string[] = [];
  if (stdout.text.length > 0) sections.push(`stdout:\n${stdout.text}`);
  if (stderr.text.length > 0) sections.push(`stderr:\n${stderr.text}`);
  return {
    text: sections.join("\n\n") || "Recipe completed with no output.",
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
  };
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

export default function justToolsExtension(pi: ExtensionAPI): void {
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

          const result = await pi.exec("just", ["--one", "--", recipe.namepath, ...arguments_], {
            cwd: ctx.cwd,
            timeout: RECIPE_TIMEOUT_MS,
            ...(signal === undefined ? {} : { signal }),
          });
          const formatted = formatResult(result);
          if (result.code !== 0 || result.killed) {
            const reason =
              signal?.aborted === true ? "cancelled" : `failed with exit code ${result.code}`;
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
