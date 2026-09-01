import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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

export function backgroundToForeground(backgroundAnsi: string): string {
  return backgroundAnsi.replace("\u001b[48;", "\u001b[38;");
}

export function foregroundToBackground(foregroundAnsi: string): string {
  return foregroundAnsi.replace("\u001b[38;", "\u001b[48;");
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
