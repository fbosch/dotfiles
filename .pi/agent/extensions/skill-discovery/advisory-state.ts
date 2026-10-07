import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { SessionEntry, SessionProjection, Skill } from "@earendil-works/pi-coding-agent";
import { isRecord } from "../shared/is-record";

export const MAX_SKILL_ADVISORY_CHARS = 6_000;
export const SKILL_ADVISORY_MESSAGE = "skill-recommendation-advice";
export const SKILL_RECOMMENDATIONS_ENTRY = "skill-recommendations";

export interface SkillAdvisoryRecord {
  readonly name: string;
  readonly path: string;
  readonly description: string;
}

export interface SkillAdvisoryState {
  readonly offered: ReadonlyMap<string, SkillAdvisoryRecord | undefined>;
  readonly read: ReadonlySet<string>;
  readonly usedCharacters: number;
  readonly branchMessageKeys: ReadonlySet<string>;
}

export interface PendingSkillAdvisory {
  readonly records: readonly SkillAdvisoryRecord[];
  readonly content: string;
}

export interface SkillAdvisoryAdmission {
  readonly records: readonly SkillAdvisoryRecord[];
  readonly content: string;
  readonly remainingCharacters: number;
  readonly skippedForBudget: number;
}

export interface SkillAdvisorySession {
  getBranch(): SessionEntry[];
  buildSessionProjection(): SessionProjection;
}

const OWNED_ADVISORY_TYPES = new Set([SKILL_ADVISORY_MESSAGE]);

// Startup messages and turn-boundary drafts use different native session entry shapes.
function ownedAdvisory(entry: SessionEntry) {
  if (entry.type === "custom_message" && entry.customType === SKILL_ADVISORY_MESSAGE) return entry;
  if (
    entry.type === "message" &&
    entry.message.role === "custom" &&
    entry.message.customType === SKILL_ADVISORY_MESSAGE
  )
    return entry.message;
  return undefined;
}

function canonicalPath(path: string, cwd: string): string {
  const expanded = path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : resolve(cwd, path);
  try {
    return realpathSync(expanded);
  } catch {
    return expanded;
  }
}

function advisoryKey(names: readonly string[]): string {
  return JSON.stringify([...new Set(names)].sort());
}

function recordsFromDetails(details: unknown): SkillAdvisoryRecord[] {
  if (!isRecord(details) || !Array.isArray(details.skills)) return [];
  return details.skills.flatMap((value) => {
    if (
      !isRecord(value) ||
      typeof value.name !== "string" ||
      typeof value.path !== "string" ||
      typeof value.description !== "string"
    ) {
      return [];
    }
    return [{ name: value.name, path: value.path, description: value.description }];
  });
}

function namesFromDetails(details: unknown): string[] {
  const records = recordsFromDetails(details);
  if (records.length > 0) return records.map(({ name }) => name);
  if (isRecord(details) && Array.isArray(details.skills)) {
    return details.skills.filter((name): name is string => typeof name === "string");
  }
  return [];
}

function recordAdvisories(
  offered: Map<string, SkillAdvisoryRecord | undefined>,
  records: readonly SkillAdvisoryRecord[],
): void {
  for (const record of records) {
    if (record.name) offered.set(record.name, record);
  }
}

function textLength(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((length, item) => {
    if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
      return length + item.text.length;
    }
    return length;
  }, 0);
}

function successfulReadNames(
  branch: ReturnType<SkillAdvisorySession["getBranch"]>,
  skills: readonly Skill[],
  cwd: string,
): Set<string> {
  const nameByPath = new Map(
    skills.map((skill) => [canonicalPath(skill.filePath, cwd), skill.name]),
  );
  const read = new Set<string>();
  const pendingReads = new Map<string, string>();
  const notePath = (path: unknown) => {
    if (typeof path !== "string") return;
    const name = nameByPath.get(canonicalPath(path, cwd));
    if (name) read.add(name);
  };

  for (const entry of branch) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role === "assistant") {
      for (const item of message.content) {
        if (item.type !== "toolCall" || item.name !== "read" || !isRecord(item.arguments)) continue;
        if (typeof item.arguments.path === "string") pendingReads.set(item.id, item.arguments.path);
      }
    } else if (message.role === "toolResult") {
      if (message.toolName === "read" && !message.isError) {
        notePath(pendingReads.get(message.toolCallId));
      }
      pendingReads.delete(message.toolCallId);

      const nestedCalls: unknown = "nestedCalls" in message ? message.nestedCalls : undefined;
      if (!isRecord(nestedCalls) || !Array.isArray(nestedCalls.calls)) continue;
      for (const call of nestedCalls.calls) {
        if (
          isRecord(call) &&
          call.name === "read" &&
          call.status === "ok" &&
          isRecord(call.arguments)
        ) {
          notePath(call.arguments.path);
        }
      }
    }
  }
  return read;
}

function recordsAndNames(details: unknown): { records: SkillAdvisoryRecord[]; names: string[] } {
  const records = recordsFromDetails(details);
  return {
    records,
    names: records.length > 0 ? records.map(({ name }) => name) : namesFromDetails(details),
  };
}

export function readSkillAdvisoryState(
  session: SkillAdvisorySession,
  skills: readonly Skill[],
  cwd: string,
): SkillAdvisoryState {
  const branch = session.getBranch();
  const offered = new Map<string, SkillAdvisoryRecord | undefined>();
  const branchMessageKeys = new Set<string>();

  for (const entry of branch) {
    if (entry.type === "custom" && entry.customType === SKILL_RECOMMENDATIONS_ENTRY) {
      const names =
        isRecord(entry.data) && Array.isArray(entry.data.skills)
          ? entry.data.skills.filter((name): name is string => typeof name === "string")
          : [];
      for (const name of names) if (name && !offered.has(name)) offered.set(name, undefined);
      continue;
    }
    const message = ownedAdvisory(entry);
    if (!message) continue;
    const advisory = recordsAndNames(message.details);
    recordAdvisories(offered, advisory.records);
    for (const name of advisory.names) if (name && !offered.has(name)) offered.set(name, undefined);
    if (advisory.names.length > 0) branchMessageKeys.add(advisoryKey(advisory.names));
  }

  let usedCharacters = 0;
  for (const projected of session.buildSessionProjection().entries) {
    const entry = projected.sourceEntry;
    const advisory = ownedAdvisory(entry);
    if (!advisory) continue;
    for (const message of projected.messages) {
      if (message.role !== "custom" || !OWNED_ADVISORY_TYPES.has(message.customType)) continue;
      const names = recordsAndNames(advisory.details).names;
      if (names.length > 0) branchMessageKeys.add(advisoryKey(names));
      usedCharacters += textLength(message.content);
    }
  }

  return {
    offered,
    read: successfulReadNames(branch, skills, cwd),
    usedCharacters,
    branchMessageKeys,
  };
}

export function includePendingSkillAdvisories(
  state: SkillAdvisoryState,
  pending: readonly PendingSkillAdvisory[],
): SkillAdvisoryState {
  if (pending.length === 0) return state;
  const offered = new Map(state.offered);
  let pendingCharacters = 0;
  for (const advisory of pending) {
    const names = advisory.records.map(({ name }) => name);
    const key = advisoryKey(names);
    if (!state.branchMessageKeys.has(key)) pendingCharacters += advisory.content.length;
    recordAdvisories(offered, advisory.records);
  }
  return { ...state, offered, usedCharacters: state.usedCharacters + pendingCharacters };
}

export function admitSkillAdvisories(
  recommendations: readonly SkillAdvisoryRecord[],
  state: Pick<SkillAdvisoryState, "offered" | "read" | "usedCharacters">,
  render: (records: readonly SkillAdvisoryRecord[]) => string,
): SkillAdvisoryAdmission {
  const records: SkillAdvisoryRecord[] = [];
  const seen = new Set<string>();
  let skippedForBudget = 0;
  for (const recommendation of recommendations) {
    if (
      !recommendation.name ||
      seen.has(recommendation.name) ||
      state.offered.has(recommendation.name) ||
      state.read.has(recommendation.name)
    ) {
      continue;
    }
    seen.add(recommendation.name);
    const candidate = [...records, recommendation];
    if (state.usedCharacters + render(candidate).length <= MAX_SKILL_ADVISORY_CHARS) {
      records.push(recommendation);
    } else {
      skippedForBudget += 1;
    }
  }
  const content = records.length > 0 ? render(records) : "";
  return {
    records,
    content,
    remainingCharacters: Math.max(
      0,
      MAX_SKILL_ADVISORY_CHARS - state.usedCharacters - content.length,
    ),
    skippedForBudget,
  };
}

export function skillAdvisoryStatus(state: SkillAdvisoryState) {
  return {
    budgetCharacters: MAX_SKILL_ADVISORY_CHARS,
    usedCharacters: state.usedCharacters,
    remainingCharacters: Math.max(0, MAX_SKILL_ADVISORY_CHARS - state.usedCharacters),
    offeredSkills: state.offered.size,
  };
}
