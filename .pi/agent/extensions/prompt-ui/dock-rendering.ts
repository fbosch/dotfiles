import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const DOCK_RAIL = "▌";
export const DOCK_RIGHT_BORDER = "▐";
export const DOCK_CHROME_WIDTH = visibleWidth(DOCK_RAIL) + visibleWidth(DOCK_RIGHT_BORDER);

export function fitColumns(left: string, right: string, width: number): string {
  if (width <= 0) return "";

  const leftText = truncateToWidth(left, width, "");
  const separatorWidth = leftText.length > 0 && right.length > 0 ? 1 : 0;
  const rightWidth = Math.max(0, width - visibleWidth(leftText) - separatorWidth);
  const rightText = truncateToWidth(right, rightWidth, "");
  const gapWidth = Math.max(0, width - visibleWidth(leftText) - visibleWidth(rightText));

  return `${leftText}${" ".repeat(gapWidth)}${rightText}`;
}

export function paintDockRow(
  content: string,
  width: number,
  rail: string,
  backgroundAnsi: string,
  rightBorder = "",
): string {
  if (width <= 0) return "";

  const fittedRail = truncateToWidth(rail, width, "");
  const fittedRightBorder = truncateToWidth(
    rightBorder,
    Math.max(0, width - visibleWidth(fittedRail)),
    "",
  );
  const contentWidth = Math.max(
    0,
    width - visibleWidth(fittedRail) - visibleWidth(fittedRightBorder),
  );
  const fittedContent = fitColumns(content, "", contentWidth);
  const backgroundContent = fittedContent
    .replaceAll("\u001b[0m", `\u001b[0m${backgroundAnsi}`)
    .replaceAll("\u001b[49m", `\u001b[49m${backgroundAnsi}`);

  return `${fittedRail}${backgroundAnsi}${backgroundContent}\u001b[49m${fittedRightBorder}`;
}

function convertAnsiColorSlot(ansi: string, slot: "background" | "foreground"): string {
  if (ansi.startsWith("\u001b[") === false) return ansi;
  const match = ansi.slice(2).match(/^([0-9;]*)m$/);
  const parameterText = match?.[1];
  if (parameterText === undefined || parameterText === "") return ansi;

  const parameters = parameterText.split(";");
  const sourceExtended = slot === "background" ? 48 : 38;
  const targetExtended = slot === "background" ? 38 : 48;
  const sourceDefault = slot === "background" ? 49 : 39;
  const targetDefault = slot === "background" ? 39 : 49;
  const sourceBasicStart = slot === "background" ? 40 : 30;
  const targetBasicStart = slot === "background" ? 30 : 40;
  const sourceBrightStart = slot === "background" ? 100 : 90;
  const targetBrightStart = slot === "background" ? 90 : 100;
  let changed = false;

  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index];
    if (parameter === undefined) continue;
    if (parameter === "") continue;

    const code = Number(parameter);
    if (code === 58) return ansi;
    if (code === 38 || code === 48) {
      const mode = Number(parameters[index + 1]);
      const valueCount = mode === 5 ? 1 : mode === 2 ? 3 : 0;
      if (valueCount === 0) return ansi;

      const values = parameters.slice(index + 2, index + 2 + valueCount);
      if (
        values.length !== valueCount ||
        values.some((value) => /^\d+$/.test(value) === false || Number(value) > 255)
      ) {
        return ansi;
      }

      if (code === sourceExtended) {
        parameters[index] = String(targetExtended);
        changed = true;
      }
      index += valueCount + 1;
      continue;
    }

    if (code === sourceDefault) {
      parameters[index] = String(targetDefault);
      changed = true;
    } else if (code >= sourceBasicStart && code <= sourceBasicStart + 7) {
      parameters[index] = String(targetBasicStart + code - sourceBasicStart);
      changed = true;
    } else if (code >= sourceBrightStart && code <= sourceBrightStart + 7) {
      parameters[index] = String(targetBrightStart + code - sourceBrightStart);
      changed = true;
    }
  }

  return changed ? `\u001b[${parameters.join(";")}m` : ansi;
}

export function backgroundToForeground(backgroundAnsi: string): string {
  return convertAnsiColorSlot(backgroundAnsi, "background");
}

export function foregroundToBackground(foregroundAnsi: string): string {
  return convertAnsiColorSlot(foregroundAnsi, "foreground");
}

export function paintDockBottomEdge(
  width: number,
  leftBorder: string,
  rightBorder: string,
  backgroundAnsi: string,
): string {
  if (width <= 0) return "";

  const fittedLeftBorder = truncateToWidth(leftBorder, width, "");
  const fittedRightBorder = truncateToWidth(
    rightBorder,
    Math.max(0, width - visibleWidth(fittedLeftBorder)),
    "",
  );
  const edgeWidth = Math.max(
    0,
    width - visibleWidth(fittedLeftBorder) - visibleWidth(fittedRightBorder),
  );
  const backgroundForegroundAnsi = backgroundToForeground(backgroundAnsi);

  return `${fittedLeftBorder}${backgroundForegroundAnsi}${"▀".repeat(edgeWidth)}\u001b[39m${fittedRightBorder}`;
}
