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
import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import {
  loadThemeFromPath,
  setThemeInstance,
  theme,
} from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import projectReferences, {
  appendProjectReferences,
  assertNoAgentMentionCollisions,
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

function writeDocsLock(cwd: string, sources: Record<string, { repo: string }>): void {
  writeFileSync(
    join(cwd, "docs-lock.json"),
    `${JSON.stringify({ version: 1, toolVersion: "0.7.0", sources })}\n`,
  );
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

  test("loads docs-cache aliases from the lock without project settings", () => {
    const cwd = temporaryDirectory();
    mkdirSync(join(cwd, ".docs", "framework"), { recursive: true });
    writeFileSync(join(cwd, ".docs", "framework", "TOC.md"), "# Docs\n");
    writeDocsLock(cwd, {
      "missing-docs": { repo: "git@github.com:owner/missing.git" },
      framework: { repo: "https://github.com/framework/core.git" },
    });

    expect(loadProjectReferences(cwd, true)).toEqual([
      {
        name: "framework",
        path: join(cwd, ".docs", "framework"),
        description: "Use for documentation from framework/core. Start with TOC.md.",
      },
      {
        name: "missing-docs",
        path: join(cwd, ".docs", "missing-docs"),
        description: "Use for documentation from owner/missing.",
      },
    ]);
  });

  test("loads and completes Unicode docs-cache aliases", async () => {
    const cwd = temporaryDirectory();
    writeDocsLock(cwd, {
      "Låneportalen-Wiki": { repo: "https://github.com/owner/loan-portal.git" },
    });

    const references = loadProjectReferences(cwd, true);
    expect(references[0]?.name).toBe("Låneportalen-Wiki");

    const provider = {
      getSuggestions: async () => null,
      applyCompletion: () => ({ lines: [""], cursorLine: 0, cursorCol: 0 }),
    } as AutocompleteProvider;
    const wrapped = createReferenceAutocompleteProvider(provider, references);
    const prompt = "inspect @Lå";
    const suggestions = await wrapped.getSuggestions([prompt], 0, prompt.length, {
      signal: AbortSignal.timeout(1_000),
    });

    expect(suggestions?.items.map((item) => item.value)).toEqual(["@Låneportalen-Wiki"]);
  });

  test("ignores project settings and docs locks until the project is trusted", () => {
    const cwd = temporaryDirectory();
    writeProjectSettings(cwd, { references: "invalid" });
    writeFileSync(join(cwd, "docs-lock.json"), "invalid\n");

    expect(loadProjectReferences(cwd, false)).toEqual([]);
  });

  test("rejects aliases shared by project settings and docs-cache", () => {
    const cwd = temporaryDirectory();
    mkdirSync(join(cwd, "docs"));
    writeProjectSettings(cwd, {
      references: { docs: { path: "docs", description: "Project documentation" } },
    });
    writeDocsLock(cwd, { docs: { repo: "https://github.com/owner/docs.git" } });

    expect(() => loadProjectReferences(cwd, true)).toThrow(
      'Docs-cache reference "docs" conflicts with project reference "docs".',
    );
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

  test("rejects aliases that collide with agent mentions", () => {
    const external = temporaryDirectory();

    expect(() =>
      assertNoAgentMentionCollisions(
        [{ name: "plan", path: external, description: "Planning material" }],
        [{ name: "Plan", description: "Creates implementation plans" }],
      ),
    ).toThrow('Project reference "plan" conflicts with agent mention @Plan.');
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

  test("preserves prototype methods and native precedence when providers are class-based", async () => {
    const nativeItem = { value: "@nixos", label: "native @nixos" };
    class ClassProvider {
      triggerCharacters = ["#"];

      async getSuggestions() {
        return { items: [nativeItem], prefix: "@ni" };
      }

      applyCompletion() {
        return { lines: ["native completion"], cursorLine: 0, cursorCol: 17 };
      }

      shouldTriggerFileCompletion() {
        return true;
      }
    }
    const wrapped = createReferenceAutocompleteProvider(
      new ClassProvider() as AutocompleteProvider,
      [{ name: "nixos", path: "/home/fbb/nixos", description: "Personal configuration" }],
    );
    const suggestions = await wrapped.getSuggestions(["inspect @ni"], 0, 11, {
      signal: AbortSignal.timeout(1_000),
    });

    expect(suggestions?.items).toEqual([nativeItem]);
    expect(wrapped.applyCompletion(["@ni"], 0, 3, nativeItem, "@ni")).toEqual({
      lines: ["native completion"],
      cursorLine: 0,
      cursorCol: 17,
    });
    expect(wrapped.shouldTriggerFileCompletion?.(["@ni"], 0, 3)).toBe(true);
  });

  test("injects trusted docs-cache references through the extension lifecycle", () => {
    const cwd = temporaryDirectory();
    mkdirSync(join(cwd, ".docs", "reference-material"), { recursive: true });
    writeDocsLock(cwd, {
      "reference-material": { repo: "https://github.com/owner/reference-material.git" },
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
    let sessionShutdown: (() => void) | undefined;
    const pi = {
      on(event: string, handler: typeof sessionStart | typeof beforeAgentStart) {
        if (event === "session_start") sessionStart = handler as typeof sessionStart;
        if (event === "before_agent_start") beforeAgentStart = handler as typeof beforeAgentStart;
        if (event === "session_shutdown") sessionShutdown = handler as () => void;
      },
    } as unknown as ExtensionAPI;
    projectReferences(pi);
    setThemeInstance(
      loadThemeFromPath(join(import.meta.dir, "..", "..", "..", "themes", "zenwritten-dark.json")),
    );
    sessionStart?.(
      {} as SessionStartEvent,
      {
        cwd,
        hasUI: false,
        isProjectTrusted: () => true,
        ui: {
          notify: () => {},
          theme,
        },
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
    expect(result?.systemPrompt).toContain("<name>reference-material</name>");
    expect(result?.systemPrompt).toContain(join(cwd, ".docs", "reference-material"));
    expect(new UserMessageComponent("Inspect @reference-material").render(80).join("\n")).toContain(
      `${theme.getFgAnsi("warning")}@reference-material`,
    );
    sessionShutdown?.();
  });
});
