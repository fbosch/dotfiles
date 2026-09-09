import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import chartExtension, { renderPieChartSvg, validatePieChartInput } from "../index";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  getFgAnsi: () => "\u001b[38;2;230;232;236m",
  getBgAnsi: () => "\u001b[48;2;25;28;38m",
} as unknown as Theme;

type PieChartExecute = (
  toolCallId: string,
  params: { labels: string[]; values: number[] },
  signal?: AbortSignal,
  onUpdate?: undefined,
  ctx?: ExtensionContext,
) => Promise<{ content: Array<{ type: string; data: string; mimeType: string }> }>;

function registerTool(): PieChartExecute {
  let execute: PieChartExecute | undefined;
  chartExtension({
    registerTool: (tool: ToolDefinition) => {
      execute = tool.execute as PieChartExecute;
    },
  } as unknown as ExtensionAPI);
  if (execute === undefined) throw new Error("pie_chart was not registered");
  return execute;
}

const context = { ui: { theme } } as unknown as ExtensionContext;

describe("pie chart", () => {
  test("validates bounded nonnegative values with a positive total", () => {
    expect(validatePieChartInput({ labels: ["Open", "Closed"], values: [3, 1] })).toEqual([
      { label: "Open", value: 3 },
      { label: "Closed", value: 1 },
    ]);
    expect(() => validatePieChartInput({ labels: ["Open"], values: [1] })).toThrow("between 2");
    expect(() => validatePieChartInput({ labels: ["Open", "Closed"], values: [1, -1] })).toThrow(
      "finite nonnegative",
    );
    expect(() => validatePieChartInput({ labels: ["Open", "Closed"], values: [0, 0] })).toThrow(
      "positive total",
    );
  });

  test("renders an escaped, theme-colored SVG without a DOM", () => {
    const svg = renderPieChartSvg(
      validatePieChartInput({ labels: ["<Open>", "Closed"], values: [3, 1] }),
      theme,
    );

    expect(svg).toContain("<svg");
    expect(svg).toContain("rgb(25, 28, 38)");
    expect(svg).toContain("&lt;Open&gt;");
    expect(svg).toContain('aria-label="Pie chart"');
  });

  test("returns a native PNG image result", async () => {
    const result = await registerTool()(
      "chart",
      { labels: ["Open", "Closed"], values: [3, 1] },
      undefined,
      undefined,
      context,
    );
    const image = result.content[0];

    expect(image).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(
      Buffer.from(image?.data ?? "", "base64")
        .subarray(1, 4)
        .toString(),
    ).toBe("PNG");
  });

  test("honors an already-aborted tool call", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      registerTool()(
        "chart",
        { labels: ["Open", "Closed"], values: [3, 1] },
        controller.signal,
        undefined,
        context,
      ),
    ).rejects.toThrow("aborted");
  });
});
