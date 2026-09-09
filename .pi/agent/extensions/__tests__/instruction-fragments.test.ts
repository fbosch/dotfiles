import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import instructionFragments, {
  appendInstructionFragments,
  INSTRUCTION_FRAGMENTS_END,
  INSTRUCTION_FRAGMENTS_START,
  instructionFragmentsForTools,
  loadGlobalInstructionFragments,
  loadInstructionFragments,
} from "../instruction-fragments";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "pi-instruction-fragments-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createInstructionsDirectory(): string {
  const directory = join(temporaryDirectory(), "instructions");
  mkdirSync(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("instruction fragments", () => {
  test("loads fragments in declared order", () => {
    const directory = createInstructionsDirectory();
    writeFileSync(join(directory, "second.md"), "Second instruction.\n");
    writeFileSync(join(directory, "first.md"), "First instruction.\n");

    const fragments = loadInstructionFragments(directory, [
      { path: "first.md" },
      { path: "second.md", when: { tools: { all: ["subagent"] } } },
    ]);

    expect(fragments.map((fragment) => fragment.content)).toEqual([
      "First instruction.",
      "Second instruction.",
    ]);
  });

  test("discovers Markdown fragments recursively when not configured", () => {
    const root = temporaryDirectory();
    const agentDirectory = join(root, "agent");
    const instructionsDirectory = join(agentDirectory, "instructions");
    mkdirSync(join(instructionsDirectory, "nested"), { recursive: true });
    writeFileSync(join(instructionsDirectory, "second.md"), "Second instruction.\n");
    writeFileSync(join(instructionsDirectory, "nested", "first.md"), "First instruction.\n");
    writeFileSync(join(instructionsDirectory, "ignored.txt"), "Not an instruction.\n");

    const fragments = loadGlobalInstructionFragments(agentDirectory);

    expect(fragments.map(({ path, when, content }) => ({ path, when, content }))).toEqual([
      { path: "nested/first.md", when: undefined, content: "First instruction." },
      { path: "second.md", when: undefined, content: "Second instruction." },
    ]);
  });

  test("loads configured paths and preserves their conditions", () => {
    const root = temporaryDirectory();
    const agentDirectory = join(root, "agent");
    const instructionsDirectory = join(agentDirectory, "instructions");
    mkdirSync(instructionsDirectory, { recursive: true });
    writeFileSync(
      join(agentDirectory, "instruction-fragments.json"),
      `${JSON.stringify([
        "second.md",
        { path: "first.md", when: { tools: { all: ["subagent", "todo"] } } },
      ])}\n`,
    );
    writeFileSync(join(instructionsDirectory, "second.md"), "Second instruction.\n");
    writeFileSync(join(instructionsDirectory, "first.md"), "First instruction.\n");

    const fragments = loadGlobalInstructionFragments(agentDirectory);

    expect(fragments.map(({ path, when, content }) => ({ path, when, content }))).toEqual([
      { path: "second.md", when: undefined, content: "Second instruction." },
      {
        path: "first.md",
        when: { tools: { all: ["subagent", "todo"] } },
        content: "First instruction.",
      },
    ]);
  });

  test("rejects invalid tool conditions", () => {
    const root = temporaryDirectory();
    const agentDirectory = join(root, "agent");
    const instructionsDirectory = join(agentDirectory, "instructions");
    mkdirSync(instructionsDirectory, { recursive: true });
    writeFileSync(join(instructionsDirectory, "fragment.md"), "Instruction.\n");

    const writeConfig = (entry: unknown) =>
      writeFileSync(
        join(agentDirectory, "instruction-fragments.json"),
        `${JSON.stringify([entry])}\n`,
      );

    writeConfig({ path: "fragment.md", when: { tools: {} } });
    expect(() => loadGlobalInstructionFragments(agentDirectory)).toThrow(
      "expected exactly one of any or all",
    );

    writeConfig({ path: "fragment.md", when: { tools: { any: [], all: ["todo"] } } });
    expect(() => loadGlobalInstructionFragments(agentDirectory)).toThrow(
      "expected exactly one of any or all",
    );

    writeConfig({ path: "fragment.md", when: { tools: { any: [] } } });
    expect(() => loadGlobalInstructionFragments(agentDirectory)).toThrow(
      "expected a non-empty array",
    );

    writeConfig({ path: "fragment.md", when: { tools: { any: [""] } } });
    expect(() => loadGlobalInstructionFragments(agentDirectory)).toThrow(
      "expected a non-empty string",
    );
  });
  test("rejects missing, empty, duplicate, and non-file fragments", () => {
    const directory = createInstructionsDirectory();
    writeFileSync(join(directory, "empty.md"), " \n");
    writeFileSync(join(directory, "valid.md"), "Valid instruction.");
    mkdirSync(join(directory, "nested.md"));

    expect(() => loadInstructionFragments(directory, [{ path: "missing.md" }])).toThrow(
      "missing.md",
    );
    expect(() => loadInstructionFragments(directory, [{ path: "empty.md" }])).toThrow(
      "Instruction fragment is empty: empty.md",
    );
    expect(() =>
      loadInstructionFragments(directory, [
        { path: "valid.md" },
        { path: "valid.md", when: { tools: { any: ["todo"] } } },
      ]),
    ).toThrow("Duplicate instruction fragment: valid.md");
    expect(() => loadInstructionFragments(directory, [{ path: "nested.md" }])).toThrow(
      "Instruction fragment must be a regular file: nested.md",
    );
  });

  test("rejects direct and symlink path escapes", () => {
    const root = temporaryDirectory();
    const directory = join(root, "instructions");
    const outside = join(root, "outside.md");
    mkdirSync(directory);
    writeFileSync(outside, "Outside instruction.");
    symlinkSync(outside, join(directory, "linked.md"));

    expect(() => loadInstructionFragments(directory, [{ path: "../outside.md" }])).toThrow(
      "Instruction fragment escapes its directory: ../outside.md",
    );
    expect(() => loadInstructionFragments(directory, [{ path: "linked.md" }])).toThrow(
      "Instruction fragment symlink escapes its directory: linked.md",
    );
  });

  test("rejects reserved markers in fragment content", () => {
    const directory = createInstructionsDirectory();
    writeFileSync(join(directory, "marked.md"), INSTRUCTION_FRAGMENTS_START);

    expect(() => loadInstructionFragments(directory, [{ path: "marked.md" }])).toThrow(
      "Instruction fragment contains a reserved marker: marked.md",
    );
  });

  test("selects unconditional fragments and matches any or all active tools", () => {
    const fragments = [
      {
        path: "orchestration.md",
        when: { tools: { all: ["subagent", "todo"] } },
        content: "Routing.",
      },
      {
        path: "code-search.md",
        when: { tools: { any: ["fffind", "ffgrep"] } },
        content: "Search.",
      },
      { path: "global.md", content: "Global." },
    ];

    expect(instructionFragmentsForTools(fragments, ["read"])).toBe("Global.");
    expect(instructionFragmentsForTools(fragments, ["read", "ffgrep"])).toBe("Search.\n\nGlobal.");
    expect(instructionFragmentsForTools(fragments, ["subagent", "todo", "fffind"])).toBe(
      "Routing.\n\nSearch.\n\nGlobal.",
    );
  });

  test("appends one marked block without changing the existing prompt", () => {
    const appended = appendInstructionFragments("base prompt", "Routing instructions.");

    expect(appended).toBe(
      `base prompt\n\n${INSTRUCTION_FRAGMENTS_START}\nRouting instructions.\n${INSTRUCTION_FRAGMENTS_END}`,
    );
    expect(appendInstructionFragments(appended, "Routing instructions.")).toBe(appended);
  });

  test("injects fragments whose active-tool conditions match", () => {
    let handler:
      | ((
          event: BeforeAgentStartEvent,
          ctx: ExtensionContext,
        ) => BeforeAgentStartEventResult | undefined)
      | undefined;
    let activeTools = ["subagent", "todo", "fffind"];
    const pi = {
      getActiveTools: () => activeTools,
      on(event: string, registeredHandler: typeof handler) {
        if (event === "before_agent_start") handler = registeredHandler;
      },
    } as unknown as ExtensionAPI;
    instructionFragments(pi);
    const event = {
      type: "before_agent_start",
      prompt: "Delegate this",
      systemPrompt: "base prompt",
      systemPromptOptions: {},
    } as BeforeAgentStartEvent;

    const systemPrompt = handler?.(event, {} as ExtensionContext)?.systemPrompt;
    expect(systemPrompt).toContain(INSTRUCTION_FRAGMENTS_START);
    expect(systemPrompt).toContain("# Subagent orchestration");
    expect(systemPrompt).toContain("# Task tracking");

    activeTools = ["todo"];
    const taskSystemPrompt = handler?.(event, {} as ExtensionContext)?.systemPrompt;
    expect(taskSystemPrompt).toContain(INSTRUCTION_FRAGMENTS_START);
    expect(taskSystemPrompt).toContain("# Task tracking");
    expect(taskSystemPrompt).not.toContain("# Subagent orchestration");

    activeTools = ["read"];
    expect(handler?.(event, {} as ExtensionContext)).toBeUndefined();
  });
});
