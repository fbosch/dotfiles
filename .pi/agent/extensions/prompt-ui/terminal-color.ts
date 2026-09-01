import type { Theme } from "@earendil-works/pi-coding-agent";

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function parseHexColor(value: string): RgbColor {
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  };
}

function colorDistance(left: RgbColor, right: RgbColor): number {
  return (left.r - right.r) ** 2 + (left.g - right.g) ** 2 + (left.b - right.b) ** 2;
}

function rgbToAnsi256(color: RgbColor): number {
  const cubeChannel = (channel: number): number =>
    channel < 48 ? 0 : channel < 115 ? 1 : Math.round((channel - 55) / 40);
  const cube = {
    r: [0, 95, 135, 175, 215, 255][cubeChannel(color.r)] ?? 0,
    g: [0, 95, 135, 175, 215, 255][cubeChannel(color.g)] ?? 0,
    b: [0, 95, 135, 175, 215, 255][cubeChannel(color.b)] ?? 0,
  };
  const cubeIndex =
    16 + 36 * cubeChannel(color.r) + 6 * cubeChannel(color.g) + cubeChannel(color.b);
  const gray = Math.round((color.r + color.g + color.b) / 3);
  const grayChannel = Math.min(23, Math.max(0, Math.round((gray - 8) / 10)));
  const grayValue = 8 + grayChannel * 10;
  const grayIndex = 232 + grayChannel;

  return colorDistance(color, cube) <=
    colorDistance(color, { r: grayValue, g: grayValue, b: grayValue })
    ? cubeIndex
    : grayIndex;
}

export function hexForegroundAnsi(theme: Theme, value: string): string {
  const color = parseHexColor(value);
  return theme.getColorMode() === "truecolor"
    ? `\u001b[38;2;${color.r};${color.g};${color.b}m`
    : `\u001b[38;5;${rgbToAnsi256(color)}m`;
}

export function colorizeHex(theme: Theme, value: string): (text: string) => string {
  const ansi = hexForegroundAnsi(theme, value);
  return (text) => `${ansi}${text}\u001b[39m`;
}
