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

function writeFragment(directory: string, name: string, content: string, frontmatter = ""): void {
  const metadata = frontmatter.length === 0 ? "" : `---\n${frontmatter}\n---\n`;
  writeFileSync(join(directory, name), `${metadata}${content}\n`);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("instruction fragments", () => {
  test("discovers Markdown fragments recursively in lexical order", () => {
    const root = temporaryDirectory();
    const agentDirectory = join(root, "agent");
    const instructionsDirectory = join(agentDirectory, "instructions");
    mkdirSync(join(instructionsDirectory, "nested"), { recursive: true });
    writeFragment(instructionsDirectory, "second.md", "Second instruction.");
    writeFragment(
      join(instructionsDirectory, "nested"),
      "first.md",
      "First instruction.",
      "when:\n  tools:\n    all:\n      - subagent\n      - todo",
    );
    writeFileSync(join(instructionsDirectory, "ignored.txt"), "Not an instruction.\n");

    const fragments = loadGlobalInstructionFragments(agentDirectory);

    expect(fragments.map(({ path, when, content }) => ({ path, when, content }))).toEqual([
      {
        path: "nested/first.md",
        when: { tools: { all: ["subagent", "todo"] } },
        content: "First instruction.",
      },
      { path: "second.md", when: undefined, content: "Second instruction." },
    ]);
  });

  test("loads explicit paths in the requested order", () => {
    const directory = createInstructionsDirectory();
    writeFragment(directory, "second.md", "Second instruction.");
    writeFragment(
      directory,
      "first.md",
      "First instruction.",
      "when:\n  tools:\n    any:\n      - subagent",
    );

    const fragments = loadInstructionFragments(directory, ["second.md", "first.md"]);

    expect(fragments.map((fragment) => fragment.content)).toEqual([
      "Second instruction.",
      "First instruction.",
    ]);
    expect(fragments[1]?.when).toEqual({ tools: { any: ["subagent"] } });
  });

  test("rejects invalid tool conditions", () => {
    const directory = createInstructionsDirectory();
    const writeInvalidFragment = (frontmatter: string) =>
      writeFragment(directory, "fragment.md", "Instruction.", frontmatter);

    writeInvalidFragment("when:\n  tools: {}");
    expect(() => loadInstructionFragments(directory)).toThrow("expected exactly one of any or all");

    writeInvalidFragment("when:\n  tools:\n    any: []\n    all:\n      - todo");
    expect(() => loadInstructionFragments(directory)).toThrow("expected exactly one of any or all");

    writeInvalidFragment("when:\n  tools:\n    any: []");
    expect(() => loadInstructionFragments(directory)).toThrow("expected a non-empty array");

    writeInvalidFragment("when:\n  tools:\n    any:\n      - ''");
    expect(() => loadInstructionFragments(directory)).toThrow("expected a non-empty string");
  });

  test("rejects malformed or unknown frontmatter", () => {
    const directory = createInstructionsDirectory();

    writeFragment(directory, "fragment.md", "Instruction.", "title: Fragment");
    expect(() => loadInstructionFragments(directory)).toThrow("unknown field");

    writeFileSync(join(directory, "fragment.md"), "---\nwhen: [\n---\nInstruction.\n");
    expect(() => loadInstructionFragments(directory)).toThrow(
      "Cannot parse instruction fragment frontmatter",
    );
  });

  test("rejects missing, empty, duplicate, and non-file fragments", () => {
    const directory = createInstructionsDirectory();
    writeFragment(directory, "empty.md", " ");
    writeFragment(directory, "valid.md", "Valid instruction.");
    mkdirSync(join(directory, "nested.md"));

    expect(() => loadInstructionFragments(directory, ["missing.md"])).toThrow("missing.md");
    expect(() => loadInstructionFragments(directory, ["empty.md"])).toThrow(
      "Instruction fragment is empty: empty.md",
    );
    expect(() => loadInstructionFragments(directory, ["valid.md", "valid.md"])).toThrow(
      "Duplicate instruction fragment: valid.md",
    );
    expect(() => loadInstructionFragments(directory, ["nested.md"])).toThrow(
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

    expect(() => loadInstructionFragments(directory, ["../outside.md"])).toThrow(
      "Instruction fragment escapes its directory: ../outside.md",
    );
    expect(() => loadInstructionFragments(directory, ["linked.md"])).toThrow(
      "Instruction fragment symlink escapes its directory: linked.md",
    );
  });

  test("rejects reserved markers in fragment content", () => {
    const directory = createInstructionsDirectory();
    writeFragment(directory, "marked.md", INSTRUCTION_FRAGMENTS_START);

    expect(() => loadInstructionFragments(directory)).toThrow(
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

  test("appends and replaces the marked instruction block", () => {
    const appended = appendInstructionFragments("base prompt", "Routing instructions.");
    expect(appended).toBe(
      `base prompt\n\n${INSTRUCTION_FRAGMENTS_START}\nRouting instructions.\n${INSTRUCTION_FRAGMENTS_END}`,
    );
    expect(
      appendInstructionFragments(`${appended}\n\nAfter instructions.`, "Search instructions."),
    ).toBe(
      `base prompt\n\n${INSTRUCTION_FRAGMENTS_START}\nSearch instructions.\n${INSTRUCTION_FRAGMENTS_END}\n\nAfter instructions.`,
    );
    expect(appendInstructionFragments(appended, "")).toBe("base prompt");
  });

  test("injects fragments for available tools, including inactive deferred tools", () => {
    let handler:
      | ((
          event: BeforeAgentStartEvent,
          ctx: ExtensionContext,
        ) => BeforeAgentStartEventResult | undefined)
      | undefined;
    let availableTools = ["subagent", "todo", "ffgrep"];
    const pi = {
      getAllTools: () => availableTools.map((name) => ({ name })),
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

    availableTools = ["todo"];
    const taskSystemPrompt = handler?.(event, {} as ExtensionContext)?.systemPrompt;
    expect(taskSystemPrompt).toContain("# Task tracking");
    expect(taskSystemPrompt).not.toContain("# Subagent orchestration");

    availableTools = ["read"];
    expect(handler?.(event, {} as ExtensionContext)).toBeUndefined();
  });
});
