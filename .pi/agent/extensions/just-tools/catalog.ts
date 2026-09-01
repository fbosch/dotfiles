import { createHash } from "node:crypto";
import { type TSchema, Type } from "typebox";

const MAX_DOCUMENTATION_LENGTH = 500;
const MAX_TOOL_NAME_LENGTH = 64;
const TOOL_NAME_PREFIX = "just_";

type ParameterKind = "singular" | "star" | "plus";

export interface JustParameter {
  name: string;
  kind: ParameterKind;
  defaultValue: unknown;
  help?: string;
  flag: boolean;
  long?: string;
  short?: string;
  multiple: boolean;
  pattern: unknown;
  value: unknown;
  min: unknown;
  max: unknown;
}

export interface JustRecipe {
  name: string;
  namepath: string;
  doc: string;
  groups: string[];
  aliases: string[];
  parameters: JustParameter[];
  source?: string;
}

interface JustAlias {
  name: string;
  target: string;
}

interface CatalogScope {
  modulePath?: string;
  source?: string;
  recipes?: unknown;
  aliases?: unknown;
  modules?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeDocumentation(value: unknown, namepath: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return `Run the Just recipe \`${namepath}\`.`;
  }

  return value.replace(/\s+/g, " ").trim().slice(0, MAX_DOCUMENTATION_LENGTH);
}

function parseParameter(value: unknown): JustParameter | undefined {
  if (!isRecord(value) || typeof value.name !== "string") return undefined;
  if (value.kind !== "singular" && value.kind !== "star" && value.kind !== "plus") {
    return undefined;
  }

  const help = optionalString(value.help);
  const long = optionalString(value.long);
  const short = optionalString(value.short);

  return {
    name: value.name,
    kind: value.kind,
    defaultValue: value.default ?? null,
    ...(help === undefined ? {} : { help }),
    flag: value.flag === true,
    ...(long === undefined ? {} : { long }),
    ...(short === undefined ? {} : { short }),
    multiple: value.multiple === true,
    pattern: value.pattern ?? null,
    value: value.value ?? null,
    min: value.min ?? null,
    max: value.max ?? null,
  };
}

function recipeGroups(attributes: unknown): string[] {
  if (!Array.isArray(attributes)) return [];

  return attributes.flatMap((attribute) => {
    if (!isRecord(attribute) || typeof attribute.group !== "string") return [];
    return [attribute.group];
  });
}

function scopedName(modulePath: string | undefined, name: string): string {
  if (name.includes("::") || modulePath === undefined) return name;
  return `${modulePath}::${name}`;
}

function parseAliases(value: unknown, modulePath: string | undefined): JustAlias[] {
  if (!isRecord(value)) return [];

  return Object.values(value).flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    if (typeof candidate.name !== "string" || typeof candidate.target !== "string") return [];
    return [
      {
        name: scopedName(modulePath, candidate.name),
        target: scopedName(modulePath, candidate.target),
      },
    ];
  });
}

function collectScope(
  value: unknown,
  recipes: JustRecipe[],
  aliases: JustAlias[],
  inheritedModulePath?: string,
): void {
  if (!isRecord(value)) return;

  const scope = value as CatalogScope;
  const modulePath = optionalString(scope.modulePath) ?? inheritedModulePath;
  const source = optionalString(scope.source);

  if (isRecord(scope.recipes)) {
    for (const candidate of Object.values(scope.recipes)) {
      if (!isRecord(candidate) || candidate.private === true) continue;
      if (typeof candidate.name !== "string") continue;

      const namepath = optionalString(candidate.namepath) ?? scopedName(modulePath, candidate.name);
      const rawParameters = Array.isArray(candidate.parameters) ? candidate.parameters : [];
      const parameters = rawParameters.map(parseParameter);
      if (parameters.some((parameter) => parameter === undefined)) continue;

      recipes.push({
        name: candidate.name,
        namepath,
        doc: normalizeDocumentation(candidate.doc, namepath),
        groups: recipeGroups(candidate.attributes),
        aliases: [],
        parameters: parameters.filter((parameter) => parameter !== undefined),
        ...(source === undefined ? {} : { source }),
      });
    }
  }

  aliases.push(...parseAliases(scope.aliases, modulePath));
  if (!isRecord(scope.modules)) return;

  for (const [name, module] of Object.entries(scope.modules)) {
    collectScope(module, recipes, aliases, scopedName(modulePath, name));
  }
}

export function parseJustCatalog(value: unknown): JustRecipe[] {
  const recipes: JustRecipe[] = [];
  const aliases: JustAlias[] = [];
  collectScope(value, recipes, aliases);

  const aliasesByTarget = new Map<string, JustAlias[]>();
  for (const alias of aliases) {
    const targetAliases = aliasesByTarget.get(alias.target) ?? [];
    targetAliases.push(alias);
    aliasesByTarget.set(alias.target, targetAliases);
  }
  return recipes
    .map((recipe) => ({
      ...recipe,
      aliases: (aliasesByTarget.get(recipe.namepath) ?? []).map((alias) => alias.name),
    }))
    .sort((left, right) => left.namepath.localeCompare(right.namepath));
}

function parameterIsComplex(parameter: JustParameter): boolean {
  return (
    parameter.flag ||
    parameter.long !== undefined ||
    parameter.short !== undefined ||
    parameter.multiple ||
    parameter.pattern !== null ||
    parameter.value !== null ||
    parameter.min !== null ||
    parameter.max !== null
  );
}

export function recipeUsesRawArguments(recipe: JustRecipe): boolean {
  return recipe.parameters.some(parameterIsComplex);
}

function hasDefault(parameter: JustParameter): boolean {
  return parameter.defaultValue !== null;
}

function parameterDescription(parameter: JustParameter): string {
  if (parameter.help !== undefined) return parameter.help;
  if (hasDefault(parameter)) return "Optional; the Justfile supplies the default when omitted.";
  if (parameter.kind === "star") return "Zero or more positional values.";
  if (parameter.kind === "plus") return "One or more positional values.";
  return "Required positional value.";
}

export function createRecipeParametersSchema(recipe: JustRecipe): TSchema {
  if (recipeUsesRawArguments(recipe)) {
    return Type.Object(
      {
        arguments: Type.Optional(
          Type.Array(Type.String(), {
            description: "Arguments passed to the recipe exactly as accepted by Just.",
          }),
        ),
      },
      { additionalProperties: false },
    );
  }

  const properties: Record<string, TSchema> = {};
  for (const parameter of recipe.parameters) {
    const description = parameterDescription(parameter);
    const schema =
      parameter.kind === "singular"
        ? Type.String({ description })
        : Type.Array(Type.String(), {
            description,
            ...(parameter.kind === "plus" ? { minItems: 1 } : {}),
          });
    const optional = parameter.kind === "star" || hasDefault(parameter);
    properties[parameter.name] = optional ? Type.Optional(schema) : schema;
  }

  return Type.Object(properties, { additionalProperties: false });
}

function requireInputRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Just recipe arguments must be an object");
  return value;
}

function requireStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Just recipe parameter \`${name}\` must be an array of strings`);
  }
  return value;
}

export function buildRecipeArguments(recipe: JustRecipe, value: unknown): string[] {
  const input = requireInputRecord(value);
  if (recipeUsesRawArguments(recipe)) {
    if (input.arguments === undefined) return [];
    return requireStringArray(input.arguments, "arguments");
  }

  const arguments_: string[] = [];
  for (const parameter of recipe.parameters) {
    const parameterValue = input[parameter.name];
    if (parameterValue === undefined) {
      if (parameter.kind === "star" || hasDefault(parameter)) continue;
      throw new Error(`Missing required Just recipe parameter \`${parameter.name}\``);
    }

    if (parameter.kind === "singular") {
      if (typeof parameterValue !== "string") {
        throw new Error(`Just recipe parameter \`${parameter.name}\` must be a string`);
      }
      arguments_.push(parameterValue);
      continue;
    }

    arguments_.push(...requireStringArray(parameterValue, parameter.name));
  }

  return arguments_;
}

export function recipeSignature(recipe: JustRecipe): string {
  return JSON.stringify(recipe.parameters);
}

export function recipeToolDescription(recipe: JustRecipe): string {
  const group = recipe.groups.length > 0 ? ` Group: ${recipe.groups.join(", ")}.` : "";
  const aliases = recipe.aliases.length > 0 ? ` Aliases: ${recipe.aliases.join(", ")}.` : "";
  return `Run Just recipe \`${recipe.namepath}\` after user confirmation. ${recipe.doc}${group}${aliases}`;
}

export function searchRecipes(recipes: JustRecipe[], query: string, limit: number): JustRecipe[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return recipes.slice(0, limit);

  const terms = normalizedQuery.split(/[^a-z0-9]+/).filter(Boolean);
  return recipes
    .map((recipe) => {
      const name = recipe.namepath.toLowerCase();
      const searchable = [name, recipe.doc, ...recipe.groups, ...recipe.aliases]
        .join(" ")
        .toLowerCase();
      let score = name === normalizedQuery ? 100 : 0;
      if (name.startsWith(normalizedQuery)) score += 40;
      for (const term of terms) {
        if (name.split(/[^a-z0-9]+/).includes(term)) score += 12;
        else if (name.includes(term)) score += 8;
        else if (searchable.includes(term)) score += 3;
      }
      return { recipe, score };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.recipe.namepath.localeCompare(right.recipe.namepath),
    )
    .slice(0, limit)
    .map(({ recipe }) => recipe);
}

function toolNameBase(namepath: string): string {
  const normalized = namepath
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${TOOL_NAME_PREFIX}${normalized || "recipe"}`.slice(0, MAX_TOOL_NAME_LENGTH);
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

export function allocateRecipeToolName(namepath: string, usedNames: Set<string>): string {
  const base = toolNameBase(namepath);
  if (!usedNames.has(base)) return base;

  for (let attempt = 0; ; attempt += 1) {
    const suffix = `_${shortHash(`${namepath}:${attempt}`)}`;
    const candidate = `${base.slice(0, MAX_TOOL_NAME_LENGTH - suffix.length)}${suffix}`;
    if (!usedNames.has(candidate)) return candidate;
  }
}
