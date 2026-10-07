import { describe, expect, test } from "bun:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager, type Skill } from "@earendil-works/pi-coding-agent";
import {
  admitSkillAdvisories,
  includePendingSkillAdvisories,
  MAX_SKILL_ADVISORY_CHARS,
  readSkillAdvisoryState,
  SKILL_ADVISORY_MESSAGE,
  type SkillAdvisoryRecord,
} from "../advisory-state";
import { formatSkillRecommendations } from "../selection";

const cwd = "/tmp/skill-advisory-test";
const record = (name: string): SkillAdvisoryRecord => ({
  name,
  path: `/skills/${name}/SKILL.md`,
  description: `${name} workflow`,
});
const catalog: Skill[] = ["direct", "nested", "failed"].map((name) => ({
  name,
  description: `${name} workflow`,
  filePath: `/skills/${name}/SKILL.md`,
  baseDir: `/skills/${name}`,
  disableModelInvocation: false,
  sourceInfo: {} as Skill["sourceInfo"],
}));
const readState = (session: SessionManager) => readSkillAdvisoryState(session, catalog, cwd);
const addAdvice = (session: SessionManager, name: string) => {
  const records = [record(name)];
  const content = formatSkillRecommendations(records);
  const id = session.appendCustomMessageEntry(SKILL_ADVISORY_MESSAGE, content, false, {
    skills: records,
  });
  return { id, records, content };
};
const call = (id: string, path: string): AssistantMessage => ({
  role: "assistant",
  api: "openai-responses",
  provider: "openai",
  model: "fixture",
  content: [{ type: "toolCall", id, name: "read", arguments: { path } }],
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "toolUse",
  timestamp: 1,
});

// Native startup custom messages and turn-boundary drafts persist in different shapes.
describe("session-wide skill advisory state", () => {
  test("counts both native advice shapes and restores offered names without double charging commits", () => {
    const session = SessionManager.inMemory(cwd);
    const initial = {
      records: [record("initial")],
      content: formatSkillRecommendations([record("initial")]),
    };
    session.appendMessage({
      role: "custom",
      customType: SKILL_ADVISORY_MESSAGE,
      content: initial.content,
      display: false,
      details: { skills: initial.records },
      timestamp: 1,
    });
    const later = addAdvice(session, "later");
    const restored = readState(session);
    expect([...restored.offered.keys()]).toEqual(["initial", "later"]);
    expect(restored.usedCharacters).toBe(initial.content.length + later.content.length);
    expect(includePendingSkillAdvisories(restored, [initial, later]).usedCharacters).toBe(
      restored.usedCharacters,
    );
  });

  test("reserves not-yet-committed drafts against the same rendered-content budget", () => {
    const session = SessionManager.inMemory(cwd);
    const pending = {
      records: [record("pending")],
      content: formatSkillRecommendations([record("pending")]),
    };
    const reserved = includePendingSkillAdvisories(readState(session), [pending]);
    expect(reserved.usedCharacters).toBe(pending.content.length);
    expect(reserved.offered.has("pending")).toBe(true);
    expect(
      admitSkillAdvisories(pending.records, reserved, formatSkillRecommendations).records,
    ).toEqual([]);
  });

  test("reclaims compacted advice capacity while retaining session-wide dedup knowledge", () => {
    const session = SessionManager.inMemory(cwd);
    const old = addAdvice(session, "old");
    const keep = session.appendMessage({ role: "user", content: "Continue", timestamp: 2 });
    const retained = addAdvice(session, "retained");
    session.appendCompaction("Task summary", keep, 10_000);
    const restored = readState(session);
    expect(restored.usedCharacters).toBe(retained.content.length);
    expect([...restored.offered.keys()]).toEqual(["old", "retained"]);
    expect(includePendingSkillAdvisories(restored, [old, retained]).usedCharacters).toBe(
      retained.content.length,
    );
    expect(
      admitSkillAdvisories([record("fresh")], restored, formatSkillRecommendations).records,
    ).toEqual([record("fresh")]);
  });

  test("charges external context replacements and omissions rather than raw historical content", () => {
    const session = SessionManager.inMemory(cwd);
    const advice = addAdvice(session, "offered");
    session.appendContextEdit(advice.id, { content: "replacement" });
    expect(readState(session).usedCharacters).toBe("replacement".length);
    session.appendContextEdit(advice.id, null);
    const restored = readState(session);
    expect(restored.usedCharacters).toBe(0);
    expect(restored.offered.has("offered")).toBe(true);
    expect(session.getBranch().find((entry) => entry.id === advice.id)).toMatchObject({
      content: advice.content,
    });
  });

  test("abandoned branches do not consume capacity or suppress advice on the active branch", () => {
    const session = SessionManager.inMemory(cwd);
    const root = session.appendMessage({ role: "user", content: "Root", timestamp: 1 });
    const advice = addAdvice(session, "abandoned");
    expect(readState(session).offered.has("abandoned")).toBe(true);
    session.branch(root);
    session.appendMessage({ role: "user", content: "Alternative", timestamp: 2 });
    expect(readState(session).offered.size).toBe(0);
    expect(readState(session).usedCharacters).toBe(0);
    session.branch(advice.id);
    expect(readState(session).offered.has("abandoned")).toBe(true);
  });

  test("restores successful direct and nested reads, but not failed reads, from the active branch", () => {
    const session = SessionManager.inMemory(cwd);
    const root = session.appendMessage({ role: "user", content: "Read skills", timestamp: 1 });
    session.appendMessage(call("direct", "/skills/direct/SKILL.md"));
    session.appendMessage({
      role: "toolResult",
      toolCallId: "direct",
      toolName: "read",
      content: [],
      isError: false,
      timestamp: 2,
    });
    session.appendMessage(call("failed", "/skills/failed/SKILL.md"));
    session.appendMessage({
      role: "toolResult",
      toolCallId: "failed",
      toolName: "read",
      content: [],
      isError: true,
      timestamp: 3,
    });
    session.appendMessage({
      role: "toolResult",
      toolCallId: "outer",
      toolName: "codemode",
      content: [],
      isError: false,
      timestamp: 4,
      nestedCalls: {
        complete: true,
        calls: [
          {
            id: "outer/1",
            name: "read",
            arguments: { path: "/skills/nested/SKILL.md" },
            status: "ok",
          },
          {
            id: "outer/2",
            name: "read",
            arguments: { path: "/skills/failed/SKILL.md" },
            status: "error",
          },
        ],
      },
    });
    expect([...readState(session).read]).toEqual(["direct", "nested"]);
    expect(
      admitSkillAdvisories(
        [record("direct"), record("nested"), record("failed")],
        readState(session),
        formatSkillRecommendations,
      ).records,
    ).toEqual([record("failed")]);
    session.branch(root);
    expect(readState(session).read.size).toBe(0);
  });

  test("admits only whole records and counts descriptions, XML escaping and boilerplate", () => {
    const first = { ...record("first"), description: '<&"'.repeat(40) };
    const second = record("second");
    const session = SessionManager.inMemory(cwd);
    const state = {
      ...readState(session),
      usedCharacters: MAX_SKILL_ADVISORY_CHARS - formatSkillRecommendations([first]).length,
    };
    const admitted = admitSkillAdvisories(
      [first, first, second],
      state,
      formatSkillRecommendations,
    );
    expect(admitted.records).toEqual([first]);
    expect(admitted.content).toBe(formatSkillRecommendations([first]));
    expect(admitted.remainingCharacters).toBe(0);
    expect(admitted.skippedForBudget).toBe(1);
    expect(admitted.content).toContain("&lt;&amp;&quot;");
  });

  test("keeps unrelated custom messages outside the advisory budget and dedup state", () => {
    const session = SessionManager.inMemory(cwd);
    session.appendCustomMessageEntry("other-extension", "x".repeat(10_000), false, {
      skills: [record("other")],
    });
    expect(readState(session).usedCharacters).toBe(0);
    expect(readState(session).offered.size).toBe(0);
  });
});
