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
      { path: "first.md", applies: "always" },
      { path: "second.md", applies: "orchestrator" },
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
    writeFileSync(join(agentDirectory, "settings.json"), "{}\n");
    writeFileSync(join(instructionsDirectory, "second.md"), "Second instruction.\n");
    writeFileSync(join(instructionsDirectory, "nested", "first.md"), "First instruction.\n");
    writeFileSync(join(instructionsDirectory, "ignored.txt"), "Not an instruction.\n");

    const fragments = loadGlobalInstructionFragments(agentDirectory, root);

    expect(fragments.map(({ path, applies, content }) => ({ path, applies, content }))).toEqual([
      { path: "nested/first.md", applies: "always", content: "First instruction." },
      { path: "second.md", applies: "always", content: "Second instruction." },
    ]);
  });

  test("loads configured paths and preserves their applicability", () => {
    const root = temporaryDirectory();
    const agentDirectory = join(root, "agent");
    const instructionsDirectory = join(agentDirectory, "instructions");
    mkdirSync(instructionsDirectory, { recursive: true });
    writeFileSync(
      join(agentDirectory, "settings.json"),
      `${JSON.stringify({
        instructionFragments: ["second.md", { path: "first.md", applies: "orchestrator" }],
      })}\n`,
    );
    writeFileSync(join(instructionsDirectory, "second.md"), "Second instruction.\n");
    writeFileSync(join(instructionsDirectory, "first.md"), "First instruction.\n");

    const fragments = loadGlobalInstructionFragments(agentDirectory, root);

    expect(fragments.map(({ path, applies, content }) => ({ path, applies, content }))).toEqual([
      { path: "second.md", applies: "always", content: "Second instruction." },
      { path: "first.md", applies: "orchestrator", content: "First instruction." },
    ]);
  });

  test("rejects missing, empty, duplicate, and non-file fragments", () => {
    const directory = createInstructionsDirectory();
    writeFileSync(join(directory, "empty.md"), " \n");
    writeFileSync(join(directory, "valid.md"), "Valid instruction.");
    mkdirSync(join(directory, "nested.md"));

    expect(() =>
      loadInstructionFragments(directory, [{ path: "missing.md", applies: "always" }]),
    ).toThrow("missing.md");
    expect(() =>
      loadInstructionFragments(directory, [{ path: "empty.md", applies: "always" }]),
    ).toThrow("Instruction fragment is empty: empty.md");
    expect(() =>
      loadInstructionFragments(directory, [
        { path: "valid.md", applies: "always" },
        { path: "valid.md", applies: "orchestrator" },
      ]),
    ).toThrow("Duplicate instruction fragment: valid.md");
    expect(() =>
      loadInstructionFragments(directory, [{ path: "nested.md", applies: "always" }]),
    ).toThrow("Instruction fragment must be a regular file: nested.md");
  });

  test("rejects direct and symlink path escapes", () => {
    const root = temporaryDirectory();
    const directory = join(root, "instructions");
    const outside = join(root, "outside.md");
    mkdirSync(directory);
    writeFileSync(outside, "Outside instruction.");
    symlinkSync(outside, join(directory, "linked.md"));

    expect(() =>
      loadInstructionFragments(directory, [{ path: "../outside.md", applies: "always" }]),
    ).toThrow("Instruction fragment escapes its directory: ../outside.md");
    expect(() =>
      loadInstructionFragments(directory, [{ path: "linked.md", applies: "always" }]),
    ).toThrow("Instruction fragment symlink escapes its directory: linked.md");
  });

  test("rejects reserved markers in fragment content", () => {
    const directory = createInstructionsDirectory();
    writeFileSync(join(directory, "marked.md"), INSTRUCTION_FRAGMENTS_START);

    expect(() =>
      loadInstructionFragments(directory, [{ path: "marked.md", applies: "always" }]),
    ).toThrow("Instruction fragment contains a reserved marker: marked.md");
  });

  test("selects always-on fragments and adds orchestrator fragments when available", () => {
    const fragments = [
      { path: "orchestration.md", applies: "orchestrator" as const, content: "Routing." },
      { path: "code-search.md", applies: "always" as const, content: "Search." },
    ];

    expect(instructionFragmentsForTools(fragments, ["read"])).toBe("Search.");
    expect(instructionFragmentsForTools(fragments, ["read", "subagent"])).toBe(
      "Routing.\n\nSearch.",
    );
  });

  test("appends one marked block without changing the existing prompt", () => {
    const appended = appendInstructionFragments("base prompt", "Routing instructions.");

    expect(appended).toBe(
      `base prompt\n\n${INSTRUCTION_FRAGMENTS_START}\nRouting instructions.\n${INSTRUCTION_FRAGMENTS_END}`,
    );
    expect(appendInstructionFragments(appended, "Routing instructions.")).toBe(appended);
  });

  test("injects always-on fragments and limits routing to sessions with the subagent tool", () => {
    let handler:
      | ((
          event: BeforeAgentStartEvent,
          ctx: ExtensionContext,
        ) => BeforeAgentStartEventResult | undefined)
      | undefined;
    let activeTools = ["subagent"];
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
    expect(systemPrompt).toContain("# Subagent Routing");
    expect(systemPrompt).toContain("# Code Search");

    activeTools = ["read"];
    const childSystemPrompt = handler?.(event, {} as ExtensionContext)?.systemPrompt;
    expect(childSystemPrompt).toContain(INSTRUCTION_FRAGMENTS_START);
    expect(childSystemPrompt).toContain("# Code Search");
    expect(childSystemPrompt).not.toContain("# Subagent Routing");
  });
});
