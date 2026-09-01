import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  filterPaletteSections,
  rootItems,
  rootSections,
  SectionedSelectList,
} from "../command-palette";

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

const plainTheme = {
  header: (text: string) => `[header]${text}`,
  label: (text: string) => text,
  description: (text: string) => text,
  shortcut: (text: string) => text,
  selected: (text: string) => `[selected]${text}`,
  scrollInfo: (text: string) => text,
  noMatch: (text: string) => text,
};

describe("sectioned command palette", () => {
  test("groups root actions without exposing duplicate IDs through rootItems", () => {
    const { items } = createHarness(false);
    const pi = { getCommands: () => [] } as unknown as ExtensionAPI;
    const sections = rootSections({} as ExtensionContext, pi);

    expect(sections.map((section) => section.label)).toEqual([
      "Suggested",
      "Session",
      "Model",
      "Tools",
      "Appearance",
      "Commands",
    ]);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  test("keeps only matching items and their section headers", () => {
    const sections = [
      {
        id: "session",
        label: "Session",
        items: [{ id: "new", label: "New Session", description: "Start fresh" }],
      },
      {
        id: "model",
        label: "Model",
        items: [{ id: "switch", label: "Switch Model", description: "Choose a model" }],
      },
    ];

    expect(filterPaletteSections(sections, "switch")).toEqual([
      {
        id: "model",
        label: "Model",
        items: [{ id: "switch", label: "Switch Model", description: "Choose a model" }],
      },
    ]);
    const sessionSection = sections[0];
    if (!sessionSection) throw new Error("Expected a session section");
    expect(filterPaletteSections(sections, "session")).toEqual([sessionSection]);
  });

  test("renders headers while navigation selects actions only", () => {
    const list = new SectionedSelectList(
      [
        {
          label: "Suggested",
          items: [{ value: "new", label: "New Session", description: "Start fresh" }],
        },
        {
          label: "Model",
          items: [{ value: "model", label: "Switch Model", description: "Choose a model" }],
        },
      ],
      10,
      plainTheme,
    );
    let selected: string | undefined;
    list.onSelect = (item) => {
      selected = item.value;
    };

    expect(list.render(60)).toEqual([
      "[header]  Suggested",
      expect.stringContaining("[selected]› New Session"),
      "",
      "[header]  Model",
      expect.stringContaining("Switch Model"),
    ]);

    list.handleInput("\u001b[B");
    list.handleInput("\r");
    expect(selected).toBe("model");

    list.handleInput("\u001b[B");
    expect(list.getSelectedItem()?.value).toBe("new");
  });

  test("right-aligns shortcuts within the available width", () => {
    const list = new SectionedSelectList(
      [
        {
          label: "Session",
          items: [
            {
              value: "new",
              label: "New Session",
              description: "Start a fresh session",
              shortcut: "ctrl+n",
            },
          ],
        },
      ],
      5,
      plainTheme,
    );

    const selectedRow = list.render(40)[1];
    expect(selectedRow).toEndWith("ctrl+n");
  });

  test("keeps scrolling within the row budget and avoids orphaned headers", () => {
    const list = new SectionedSelectList(
      [
        {
          label: "First",
          items: [
            { value: "first:1", label: "One" },
            { value: "first:2", label: "Two" },
          ],
        },
        { label: "Second", items: [{ value: "second", label: "Three" }] },
        { label: "Third", items: [{ value: "third", label: "Four" }] },
      ],
      5,
      plainTheme,
    );

    for (let index = 0; index < 3; index += 1) list.handleInput("\u001b[B");
    const lines = list.render(40);

    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines.some((line) => line.includes("[header]  Third"))).toBeTrue();
    expect(lines.some((line) => line.includes("[selected]› Four"))).toBeTrue();
    expect(lines.some((line) => line.includes("[header]  First"))).toBeFalse();
  });

  test("does not render structural or status rows outside the row budget", () => {
    const sections = [
      { label: "First", items: [{ value: "first", label: "One" }] },
      { label: "Second", items: [{ value: "second", label: "Two" }] },
      { label: "Third", items: [{ value: "third", label: "Three" }] },
    ];
    const oneRowList = new SectionedSelectList(sections, 1, plainTheme);
    const fiveRowList = new SectionedSelectList(sections, 5, plainTheme);

    expect(oneRowList.render(40)).toHaveLength(1);
    const fiveRows = fiveRowList.render(40);
    expect(fiveRows).toHaveLength(3);
    expect(fiveRows.some((line) => line.includes("[header]  Second"))).toBeFalse();
  });

  test("applies selected styling after wide-text truncation", () => {
    const selectedTheme = {
      ...plainTheme,
      selected: (text: string) => `\u001b[44m${text}\u001b[0m`,
    };
    const list = new SectionedSelectList(
      [
        {
          label: "Session",
          items: [
            {
              value: "wide",
              label: "非常に長いセッション名",
              description: "Long description",
              shortcut: "ctrl+n",
            },
          ],
        },
      ],
      5,
      selectedTheme,
    );

    const selectedRow = list.render(24)[1] ?? "";
    expect(visibleWidth(selectedRow)).toBe(24);
    expect(selectedRow.split("\u001b[0m")).toHaveLength(2);
    expect(selectedRow).toEndWith("ctrl+n\u001b[0m");
  });
});
