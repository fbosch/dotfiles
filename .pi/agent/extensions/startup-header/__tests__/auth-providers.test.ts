import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { createAuthStartupPayload, readAuthStartupPayload } from "../owner-payloads";
import { renderStartupHeader } from "../view-model";

const theme = { fg: (_color: string, text: string) => text } as Theme;
const NOW = 1_000_000;
const HOUR = 3_600_000;

const payload = createAuthStartupPayload(
  "kk",
  ["kk", "ct"],
  [
    {
      profileLabel: "kk",
      provider: "openai-codex",
      windows: [{ windowId: "primary", remaining: 80, allowanceResetAt: NOW + 2 * HOUR }],
      bankedResetCount: 1,
      providers: [
        {
          provider: "anthropic",
          borrowedFrom: "ct",
          windows: [
            { windowId: "primary", remaining: 64, allowanceResetAt: NOW + HOUR },
            { windowId: "secondary", remaining: 91 },
          ],
        },
      ],
      observedAt: NOW,
      staleAt: NOW + HOUR,
    },
    {
      profileLabel: "ct",
      provider: "openai-codex",
      windows: [{ windowId: "primary", remaining: 50 }],
      observedAt: NOW,
      staleAt: NOW + HOUR,
    },
  ],
);

const snapshot = {
  type: "reply" as const,
  schemaVersion: 1 as const,
  sessionId: "session",
  generationId: "generation",
  ownerId: "auth" as const,
  ownerRevision: 1,
  state: "ready" as const,
  payload,
};

function render(width: number): string[] {
  return renderStartupHeader(
    theme,
    width,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    snapshot,
    undefined,
    undefined,
    NOW,
  ).map((line) => stripVTControlCharacters(line));
}

describe("startup header auth providers", () => {
  test("payload keeps fallback providers and drops malformed ones", () => {
    expect(readAuthStartupPayload(payload)?.profiles[0]?.providers).toEqual([
      {
        provider: "anthropic",
        borrowedFrom: "ct",
        windows: [
          { windowId: "primary", remaining: 64, allowanceResetAt: NOW + HOUR },
          { windowId: "secondary", remaining: 91 },
        ],
      },
    ]);
    expect(
      readAuthStartupPayload({
        activeProfile: "kk",
        profiles: [
          {
            profileLabel: "kk",
            status: "reported",
            windows: [],
            providers: [{ provider: "anthropic", windows: [{ windowId: "primary" }] }],
            observedAt: NOW,
            staleAt: NOW + HOUR,
          },
        ],
      }),
    ).toBeUndefined();
  });

  test("table shows one row per provider and points borrowed credentials at their owner", () => {
    const lines = render(120).map((line) => line.replace(/\s+/g, " "));
    const row = (label: string) => lines.find((line) => line.includes(label)) ?? "";
    const rawRow = (label: string) =>
      renderStartupHeader(
        theme,
        120,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        snapshot,
        undefined,
        undefined,
        NOW,
      ).find((line) => line.includes(label)) ?? "";
    expect(row("Profile")).toContain("Provider");
    expect(row("kk [active]")).toContain("\uec81 Codex │ 80% · 2h │");
    expect(row("via ct")).toContain("\uec82 Claude");
    expect(row("kk [active]")).toContain("1 banked");
    // Provider names carry their brand color.
    expect(rawRow("Claude")).toContain("\x1b[38;2;183;126;100m");
    expect(lines.filter((line) => line.includes("64%"))).toEqual([]);
    expect(row("ct [next]")).toContain("50%");
  });

  test("a credential borrowed from a hidden profile shows its own usage", () => {
    const hidden = createAuthStartupPayload(
      "kk",
      ["kk"],
      [
        {
          profileLabel: "kk",
          provider: "openai-codex",
          windows: [],
          providers: [
            {
              provider: "anthropic",
              borrowedFrom: "default",
              windows: [{ windowId: "primary", remaining: 64, allowanceResetAt: NOW + HOUR }],
            },
          ],
          observedAt: NOW,
          staleAt: NOW + HOUR,
        },
      ],
    );
    const lines = renderStartupHeader(
      theme,
      120,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { ...snapshot, payload: hidden },
      undefined,
      undefined,
      NOW,
    ).map((line) => stripVTControlCharacters(line).replace(/\s+/g, " "));
    expect(lines.find((line) => line.includes("Claude"))).toContain("64% · 1h");
  });

  test("compact view lists provider windows under the profile", () => {
    const lines = render(60);
    const start = lines.indexOf("kk [active] [openai-codex]");
    expect(lines.slice(start + 1, start + 6)).toEqual([
      "  \uec81 Codex",
      "    primary: 80% · reset 2h",
      "  \uec82 Claude (ct)",
      "    primary: 64% · reset 1h",
      "    secondary: 91%",
    ]);
  });

  test("credit-based usage keeps the credit share and spend in their own columns", () => {
    const credit = createAuthStartupPayload(
      "ct",
      ["ct"],
      [
        {
          profileLabel: "ct",
          provider: "openai-codex",
          windows: [],
          providers: [
            {
              provider: "anthropic",
              windows: [{ windowId: "credit", remaining: 99, detail: "$2.78 of $500.00" }],
            },
          ],
          observedAt: NOW,
          staleAt: NOW + HOUR,
        },
      ],
    );
    const lines = (width: number) =>
      renderStartupHeader(
        theme,
        width,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { ...snapshot, payload: credit },
        undefined,
        undefined,
        NOW,
      ).map((line) => stripVTControlCharacters(line));
    const row = lines(120).find((line) => line.includes("Claude")) ?? "";
    expect(row.replace(/\s+/g, " ")).toContain("│ 99% credit │ │ $2.78 / $500.00 │");
    // Every column separator survives, so the row lines up with the borders.
    const border = lines(120).find((line) => line.startsWith("┌")) ?? "";
    expect(row.length).toBe(border.length);
    expect([...row].filter((character) => character === "│")).toHaveLength(
      [...border].filter((character) => character === "┬").length + 2,
    );
    expect(lines(60)).toContain("    credit: 99% · $2.78 of $500.00");
  });

  test("credit spend turns warning at 70% used and error at 90% used", () => {
    const markedTheme = {
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
    } as Theme;
    const spendColor = (remaining: number) => {
      const payload = createAuthStartupPayload(
        "ct",
        ["ct"],
        [
          {
            profileLabel: "ct",
            provider: "openai-codex",
            windows: [],
            providers: [
              {
                provider: "anthropic",
                windows: [{ windowId: "credit", remaining, detail: "$1 of $2" }],
              },
            ],
            observedAt: NOW,
            staleAt: NOW + HOUR,
          },
        ],
      );
      const row =
        renderStartupHeader(
          markedTheme,
          120,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { ...snapshot, payload },
          undefined,
          undefined,
          NOW,
        ).find((line) => line.includes("$1 / $2")) ?? "";
      return /<(\w+)>\$1 \/ \$2/.exec(row)?.[1];
    };
    expect(spendColor(31)).toBe("muted");
    expect(spendColor(30)).toBe("warning");
    expect(spendColor(11)).toBe("warning");
    expect(spendColor(10)).toBe("error");
  });
});
