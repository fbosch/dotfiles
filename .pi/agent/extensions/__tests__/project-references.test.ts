import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ExtensionContext,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import projectReferences, {
  appendProjectReferences,
  createReferenceAutocompleteProvider,
  formatProjectReferences,
  loadProjectReferences,
  PROJECT_REFERENCES_START,
} from "../project-references";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "pi-project-references-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeProjectSettings(cwd: string, settings: unknown): void {
  mkdirSync(join(cwd, ".pi"));
  writeFileSync(join(cwd, ".pi", "settings.json"), `${JSON.stringify(settings)}\n`);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("project references", () => {
  test("loads trusted relative and home paths in stable name order", () => {
    const root = temporaryDirectory();
    const cwd = join(root, "project");
    const home = join(root, "home");
    mkdirSync(cwd);
    mkdirSync(join(cwd, "docs"));
    mkdirSync(join(home, "nixos"), { recursive: true });
    writeProjectSettings(cwd, {
      references: {
        nixos: { path: "~/nixos", description: "Personal NixOS configuration" },
        docs: { path: "docs", description: "Project documentation" },
      },
    });

    expect(loadProjectReferences(cwd, true, home)).toEqual([
      {
        name: "docs",
        path: realpathSync(join(cwd, "docs")),
        description: "Project documentation",
      },
      {
        name: "nixos",
        path: realpathSync(join(home, "nixos")),
        description: "Personal NixOS configuration",
      },
    ]);
  });

  test("ignores project settings until the project is trusted", () => {
    const cwd = temporaryDirectory();
    writeProjectSettings(cwd, { references: "invalid" });

    expect(loadProjectReferences(cwd, false)).toEqual([]);
  });

  test("rejects malformed entries and paths that are not directories", () => {
    const cwd = temporaryDirectory();
    writeFileSync(join(cwd, "file.txt"), "not a directory");
    writeProjectSettings(cwd, {
      references: { docs: { path: "file.txt", description: "Documentation" } },
    });

    expect(() => loadProjectReferences(cwd, true)).toThrow(
      'Cannot resolve project reference "docs"',
    );
  });

  test("formats escaped reference metadata and appends it once", () => {
    const references = [{ name: "docs", path: "/tmp/a&b", description: "Docs <current>" }];
    const formatted = formatProjectReferences(references);

    expect(formatted).toContain("<path>/tmp/a&amp;b</path>");
    expect(formatted).toContain("<description>Docs &lt;current&gt;</description>");
    const appended = appendProjectReferences("base prompt", references);
    expect(appended).toContain(PROJECT_REFERENCES_START);
    expect(appendProjectReferences(appended, references)).toBe(appended);
  });

  test("adds named references ahead of existing at-sign suggestions", async () => {
    const provider = {
      triggerCharacters: ["#"],
      getSuggestions: async () => ({
        items: [{ value: "@native", label: "@native" }],
        prefix: "@ni",
      }),
      applyCompletion: () => ({ lines: [""], cursorLine: 0, cursorCol: 0 }),
    } as AutocompleteProvider;
    const wrapped = createReferenceAutocompleteProvider(provider, [
      { name: "nixos", path: "/home/fbb/nixos", description: "Personal configuration" },
    ]);

    expect(wrapped.triggerCharacters).toEqual(["#", "@"]);
    const suggestions = await wrapped.getSuggestions(["inspect @ni"], 0, 11, {
      signal: AbortSignal.timeout(1_000),
    });
    expect(suggestions?.prefix).toBe("@ni");
    expect(suggestions?.items.map((item) => item.value)).toEqual(["@nixos", "@native"]);
  });

  test("preserves native file suggestions when no reference matches", async () => {
    const nativeSuggestions = {
      items: [{ value: "@opencode.json", label: "@opencode.json" }],
      prefix: "@open",
    };
    const provider = {
      getSuggestions: async () => nativeSuggestions,
      applyCompletion: () => ({ lines: [""], cursorLine: 0, cursorCol: 0 }),
    } as AutocompleteProvider;
    const wrapped = createReferenceAutocompleteProvider(provider, [
      { name: "nixos", path: "/home/fbb/nixos", description: "Personal configuration" },
    ]);

    expect(
      await wrapped.getSuggestions(["inspect @open"], 0, 13, {
        signal: AbortSignal.timeout(1_000),
      }),
    ).toBe(nativeSuggestions);
  });

  test("injects trusted references through the extension lifecycle", () => {
    const cwd = temporaryDirectory();
    mkdirSync(join(cwd, "docs"));
    writeProjectSettings(cwd, {
      references: { docs: { path: "docs", description: "Project documentation" } },
    });
    let sessionStart:
      | ((event: SessionStartEvent, ctx: ExtensionContext) => void | Promise<void>)
      | undefined;
    let beforeAgentStart:
      | ((
          event: BeforeAgentStartEvent,
          ctx: ExtensionContext,
        ) => BeforeAgentStartEventResult | undefined)
      | undefined;
    const pi = {
      on(event: string, handler: typeof sessionStart | typeof beforeAgentStart) {
        if (event === "session_start") sessionStart = handler as typeof sessionStart;
        if (event === "before_agent_start") beforeAgentStart = handler as typeof beforeAgentStart;
      },
    } as unknown as ExtensionAPI;
    projectReferences(pi);
    sessionStart?.(
      {} as SessionStartEvent,
      {
        cwd,
        hasUI: false,
        isProjectTrusted: () => true,
        ui: { notify: () => {} },
      } as unknown as ExtensionContext,
    );

    const result = beforeAgentStart?.(
      {
        type: "before_agent_start",
        prompt: "Inspect docs",
        systemPrompt: "base prompt",
        systemPromptOptions: {},
      } as BeforeAgentStartEvent,
      {} as ExtensionContext,
    );
    expect(result?.systemPrompt).toContain("<name>docs</name>");
    expect(result?.systemPrompt).toContain(realpathSync(join(cwd, "docs")));
  });
});
