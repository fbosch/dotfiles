import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { rootItems } from "../command-palette";

function createHarness(contextCommandAvailable: boolean) {
  const sentMessages: Array<[string, { expandPromptTemplates?: boolean } | undefined]> = [];
  const pi = {
    getCommands: () =>
      contextCommandAvailable
        ? [
            {
              name: "context",
              source: "extension",
              sourceInfo: { source: "package" },
            },
          ]
        : [],
    sendUserMessage: (
      message: string,
      options: { expandPromptTemplates?: boolean } | undefined,
    ) => {
      sentMessages.push([message, options]);
    },
  } as unknown as ExtensionAPI;
  const items = rootItems({} as ExtensionContext, pi);

  return { items, sentMessages };
}

describe("command palette context view", () => {
  test("omits context inspection when the plugin command is unavailable", () => {
    const { items } = createHarness(false);

    expect(items.some((item) => item.id === "context")).toBeFalse();
  });

  test("offers usage and injection views when the plugin command is available", async () => {
    const { items, sentMessages } = createHarness(true);
    const contextItem = items.find((item) => item.id === "context");
    const children = await contextItem?.children?.();

    expect(children?.map((item) => item.id)).toEqual(["context:usage", "context:injections"]);

    await children?.[0]?.action?.();
    await children?.[1]?.action?.();
    expect(sentMessages).toEqual([
      ["/context usage", { expandPromptTemplates: true }],
      ["/context injections", { expandPromptTemplates: true }],
    ]);
  });
});
