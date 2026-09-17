import { describe, expect, test } from "bun:test";
import { composeSessionTitle, extractTicketReferences, generateTitle } from "../index";

describe("extractTicketReferences", () => {
  test("keeps hash and prefixed ticket references in source order", () => {
    expect(extractTicketReferences("Fix #290123 before AB#12903, then revisit #290123")).toEqual([
      "#290123",
      "AB#12903",
    ]);
  });

  test("does not extract the hash suffix from a prefixed reference twice", () => {
    expect(extractTicketReferences("Handle AB#12903")).toEqual(["AB#12903"]);
  });
});

describe("composeSessionTitle", () => {
  test("restores exact ticket references omitted by the model", () => {
    expect(
      composeSessionTitle("Repair session title generation", "Please fix AB#12903 and #290123"),
    ).toBe("AB#12903 #290123 Repair session title generation");
  });

  test("canonicalizes model output without duplicating references", () => {
    expect(composeSessionTitle('## Session title: "#290123 Fix the parser."', "Fix #290123")).toBe(
      "#290123 Fix the parser",
    );
  });

  test("keeps metadata when the title must be truncated", () => {
    const title = composeSessionTitle(
      "Implement a deliberately long description of the session title generation behavior and its safeguards",
      "Work on AB#12903",
    );

    expect(title?.startsWith("AB#12903 ")).toBe(true);
    expect(title?.length).toBeLessThanOrEqual(72);
  });

  test("can use a ticket reference as the entire title", () => {
    expect(composeSessionTitle("", "Investigate #290123")).toBe("#290123");
  });
});

describe("generateTitle", () => {
  test("uses configured model and low reasoning without changing the active model", async () => {
    const model = {
      provider: "openai-codex",
      id: "gpt-5.6-luna-fast",
      api: "openai-codex-responses",
    };
    const calls: Array<{ model: unknown; options: unknown }> = [];
    const ctx = {
      modelRegistry: {
        find: (provider: string, id: string) => {
          expect([provider, id]).toEqual(["openai-codex", "gpt-5.6-luna-fast"]);
          return model;
        },
        complete: async (requestModel: unknown, _context: unknown, options: unknown) => {
          calls.push({ model: requestModel, options });
          return {
            content: [{ type: "text", text: "Repair title generation" }],
            stopReason: "stop",
          };
        },
      },
    } as unknown as Parameters<typeof generateTitle>[0];

    const title = await generateTitle(ctx, "Fix title generation", "", {
      model: { provider: "openai-codex", id: "gpt-5.6-luna-fast" },
      thinkingLevel: "low",
    });
    expect(title).toBe("Repair title generation");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe(model);
    expect(calls[0]?.options).toMatchObject({
      maxTokens: 40,
      reasoningEffort: "low",
    });
  });
});
