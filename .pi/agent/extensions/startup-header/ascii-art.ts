import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

export const STARTUP_HEADER_ART_FILE = "startup-header.txt";
export const STARTUP_HEADER_CONFIG_FILE = "startup-header.json";

const COLOR_ROLES: Readonly<Record<string, ThemeColor>> = {
  "1": "accent",
  "2": "success",
  "3": "warning",
  "4": "error",
  "5": "text",
  "6": "muted",
  "7": "dim",
  "8": "border",
  "9": "toolTitle",
};

const NAMED_COLORS: Readonly<Record<string, number>> = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
};

export interface StartupHeaderArtContext {
  readonly cwd: string;
  isProjectTrusted(): boolean;
}

export interface StartupHeaderArt {
  readonly lines: readonly string[];
  readonly colors: Readonly<Record<string, string>>;
}

export function loadStartupHeaderArt(
  context: StartupHeaderArtContext,
  home = homedir(),
): StartupHeaderArt | undefined {
  const trusted = context.isProjectTrusted();
  const directories = [
    ...(trusted ? [join(context.cwd, CONFIG_DIR_NAME)] : []),
    join(home, CONFIG_DIR_NAME, "agent"),
  ];
  const lines = readFirst(directories, STARTUP_HEADER_ART_FILE, normalizeArt);
  if (lines === undefined) return undefined;
  const colors = readFirst(directories, STARTUP_HEADER_CONFIG_FILE, parseColorConfig) ?? {};
  return { lines, colors };
}

export function renderStartupHeaderArt(
  theme: Theme,
  width: number,
  art: StartupHeaderArt | undefined,
): string[] {
  if (width <= 0) return [];
  if (art === undefined) return [theme.fg("accent", "pi")];
  return art.lines.map((line) => truncateToWidth(renderLine(theme, line, art.colors), width, ""));
}

function readFirst<T>(
  directories: readonly string[],
  filename: string,
  parse: (content: string) => T,
): T | undefined {
  for (const directory of directories) {
    try {
      return parse(readFileSync(join(directory, filename), "utf8"));
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }
  return undefined;
}

function normalizeArt(content: string): string[] {
  const lines = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function parseColorConfig(content: string): Readonly<Record<string, string>> {
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null || !("color" in parsed)) {
    throw new Error(`${STARTUP_HEADER_CONFIG_FILE} must contain a color object`);
  }
  const color = (parsed as { color?: unknown }).color;
  if (typeof color !== "object" || color === null || Array.isArray(color)) {
    throw new Error(`${STARTUP_HEADER_CONFIG_FILE} must contain a color object`);
  }

  const result: Record<string, string> = {};
  for (const [marker, value] of Object.entries(color)) {
    if (!/^[1-9]$/.test(marker) || typeof value !== "string" || !isSupportedColor(value)) {
      throw new Error(`Invalid startup header color ${marker}: ${String(value)}`);
    }
    result[marker] = value;
  }
  return result;
}

function renderLine(theme: Theme, line: string, colors: Readonly<Record<string, string>>): string {
  let rendered = "";
  let segment = "";
  let marker: string | undefined;
  const flush = () => {
    rendered += colorize(theme, marker, colors, segment);
    segment = "";
  };

  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character !== "$") {
      segment += character;
      continue;
    }

    const next = line[index + 1];
    if (next === "$") {
      segment += "$";
      index++;
      continue;
    }
    if (next !== undefined && next in COLOR_ROLES) {
      flush();
      marker = next;
      index++;
      continue;
    }
    segment += character;
  }
  flush();
  return rendered;
}

function colorize(
  theme: Theme,
  marker: string | undefined,
  colors: Readonly<Record<string, string>>,
  text: string,
): string {
  if (marker === undefined) return text;
  const configured = colors[marker];
  if (configured === undefined) return theme.fg(COLOR_ROLES[marker] ?? "text", text);
  const ansi = colorAnsi(theme, configured);
  return `${ansi}${text}\u001b[39m`;
}

function colorAnsi(theme: Theme, color: string): string {
  const named = NAMED_COLORS[color.toLowerCase()];
  if (named !== undefined) return `\u001b[${named}m`;
  if (/^[0-9]+(?:;[0-9]+)*$/.test(color)) return `\u001b[${color}m`;

  const expanded =
    color.length === 4
      ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
      : color;
  const red = Number.parseInt(expanded.slice(1, 3), 16);
  const green = Number.parseInt(expanded.slice(3, 5), 16);
  const blue = Number.parseInt(expanded.slice(5, 7), 16);
  if (theme.getColorMode() === "truecolor") return `\u001b[38;2;${red};${green};${blue}m`;
  return `\u001b[38;5;${rgbToAnsi256(red, green, blue)}m`;
}

function rgbToAnsi256(red: number, green: number, blue: number): number {
  const channel = (value: number) =>
    value < 48 ? 0 : value < 115 ? 1 : Math.round((value - 55) / 40);
  return 16 + 36 * channel(red) + 6 * channel(green) + channel(blue);
}

function isSupportedColor(value: string): boolean {
  return (
    /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value) ||
    /^[0-9]+(?:;[0-9]+)*$/.test(value) ||
    value.toLowerCase() in NAMED_COLORS
  );
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
