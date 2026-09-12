import { join } from "node:path";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { readJsonConfig } from "../../lib/extension-config";

export const FOOTER_SETTINGS_KEY = "footer";
const SETTINGS_FILE = "settings.json";

const FOOTER_NAMED_COLORS: Readonly<Record<string, number>> = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  purple: 35,
  cyan: 36,
  white: 37,
};

export interface FooterCustomization {
  readonly icon?: string;
  readonly color?: string;
}

export function loadFooterCustomization(
  context: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
  agentDirectory = getAgentDir(),
): FooterCustomization | undefined {
  const project = context.isProjectTrusted()
    ? readFooterSettings(join(context.cwd, CONFIG_DIR_NAME, SETTINGS_FILE))
    : undefined;
  const configured =
    project === undefined ? readFooterSettings(join(agentDirectory, SETTINGS_FILE)) : project;
  return configured === undefined ? undefined : parseFooterCustomization(configured);
}
function readFooterSettings(path: string): unknown {
  const settings = readJsonConfig(path);
  if (settings === undefined) return undefined;
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    throw new Error(`${SETTINGS_FILE} must contain an object`);
  }

  const record = settings as Record<string, unknown>;
  return Object.hasOwn(record, FOOTER_SETTINGS_KEY) ? record[FOOTER_SETTINGS_KEY] : undefined;
}

function parseFooterCustomization(value: unknown): FooterCustomization {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${SETTINGS_FILE}.${FOOTER_SETTINGS_KEY} must contain an object`);
  }

  const config = value as Record<string, unknown>;
  const icon = config.icon;
  if (
    icon !== undefined &&
    (typeof icon !== "string" || icon.length === 0 || hasControlCharacter(icon))
  ) {
    throw new Error(
      `${SETTINGS_FILE}.${FOOTER_SETTINGS_KEY}.icon must be a non-empty single-line string`,
    );
  }

  const color = config.color;
  if (
    color !== undefined &&
    (typeof color !== "string" || isSupportedFooterColor(color) === false)
  ) {
    throw new Error(`${SETTINGS_FILE}.${FOOTER_SETTINGS_KEY}.color must be a supported color`);
  }

  return {
    ...(icon === undefined ? {} : { icon }),
    ...(color === undefined ? {} : { color }),
  };
}

function isSupportedFooterColor(value: string): boolean {
  return (
    /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value) ||
    isForegroundSgrColor(value) ||
    Object.hasOwn(FOOTER_NAMED_COLORS, value.toLowerCase())
  );
}

export function colorizeFooterIcon(
  theme: Pick<Theme, "fg"> & Partial<Pick<Theme, "getColorMode">>,
  customization: FooterCustomization,
): string {
  const icon = customization.icon;
  if (icon === undefined) return "";

  const color = customization.color;
  if (color === undefined) return theme.fg("accent", icon);
  if (isSupportedFooterColor(color) === false) return theme.fg("accent", icon);

  const namedColor = FOOTER_NAMED_COLORS[color.toLowerCase()];
  if (namedColor !== undefined) return `\u001b[${namedColor}m${icon}\u001b[39m`;
  if (isForegroundSgrColor(color)) return `\u001b[${color}m${icon}\u001b[39m`;

  const expanded =
    color.length === 4
      ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
      : color;
  const red = Number.parseInt(expanded.slice(1, 3), 16);
  const green = Number.parseInt(expanded.slice(3, 5), 16);
  const blue = Number.parseInt(expanded.slice(5, 7), 16);
  const ansi =
    theme.getColorMode?.() === "truecolor"
      ? `\u001b[38;2;${red};${green};${blue}m`
      : `\u001b[38;5;${rgbToAnsi256(red, green, blue)}m`;
  return `${ansi}${icon}\u001b[39m`;
}

function isForegroundSgrColor(value: string): boolean {
  const parts = value.split(";");
  if (parts.some((part) => /^[0-9]+$/u.test(part) === false)) return false;

  const numbers = parts.map(Number);
  if (numbers.length === 1) {
    const code = numbers[0];
    return code !== undefined && ((code >= 30 && code <= 37) || (code >= 90 && code <= 97));
  }
  if (numbers.length === 3 && numbers[0] === 38 && numbers[1] === 5) {
    const paletteIndex = numbers[2];
    return paletteIndex !== undefined && isByte(paletteIndex);
  }
  if (numbers.length === 5 && numbers[0] === 38 && numbers[1] === 2) {
    return numbers.slice(2).every(isByte);
  }
  return false;
}

function isByte(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

function rgbToAnsi256(red: number, green: number, blue: number): number {
  const channel = (value: number) =>
    value < 48 ? 0 : value < 115 ? 1 : Math.round((value - 55) / 40);
  return 16 + 36 * channel(red) + 6 * channel(green) + channel(blue);
}

function hasControlCharacter(value: string): boolean {
  return /\p{Cc}/u.test(value);
}
