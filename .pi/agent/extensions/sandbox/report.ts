import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AccessDecision,
  type AccessGrants,
  type AccessKind,
  explainAccess,
} from "../../lib/nono-access";
import type { NonoCapabilities } from "../../lib/nono-capabilities";

const LIST_TOPICS = ["write", "read", "denied", "exceptions", "commands", "domains"] as const;
export type ListTopic = (typeof LIST_TOPICS)[number];

export const USAGE = [
  "Usage:",
  "/sandbox                          summary of the effective nono capabilities",
  `/sandbox list <${LIST_TOPICS.join("|")}>`,
  "/sandbox explain <path> [read|write]   (default: write)",
].join("\n");

const NOTE =
  "Declared nono capabilities, not verified confinement. A grant does not override command or deny rules.";

type Grant = AccessGrants["fs"][number];

const writable = (grant: Grant) => grant.access !== "read";
const readable = (grant: Grant) => grant.access !== "write";

function entry(grant: Grant): string {
  const source = grant.source === undefined ? "" : `, ${grant.source}`;
  return `${grant.path}${grant.is_file ? "" : "/"}  [${grant.access}${source}]`;
}

export function summarize(capabilities: NonoCapabilities): string {
  const writes = capabilities.fs.filter(writable);
  const reads = capabilities.fs.filter((grant) => !writable(grant));
  const sources = new Map<string, number>();
  for (const grant of reads) sources.set(grant.source, (sources.get(grant.source) ?? 0) + 1);
  return [
    "Sandbox: nono",
    NOTE,
    "",
    `Writable (${writes.length}):`,
    ...writes.map((grant) => `  ${entry(grant)}`),
    "",
    `Read-only: ${reads.length} grants (${[...sources].map(([source, count]) => `${source} ${count}`).join(", ")})`,
    `Denied paths: ${capabilities.deny_paths.length}; applied exceptions: ${capabilities.applied_bypasses.length}`,
    `Commands: ${capabilities.blocked_commands.length} blocked, ${capabilities.allowed_commands.length} explicitly allowed`,
    `Network: ${capabilities.net_blocked ? "blocked" : "not blocked"}; allowed domains: ${capabilities.allowed_domains.length}`,
    "",
    `Details: /sandbox list <${LIST_TOPICS.join("|")}>; /sandbox explain <path>`,
  ].join("\n");
}

export function list(capabilities: NonoCapabilities, topic: ListTopic): string {
  const lines = {
    write: () => capabilities.fs.filter(writable).map(entry),
    read: () => capabilities.fs.filter(readable).map(entry),
    denied: () => [...capabilities.deny_paths],
    exceptions: () =>
      capabilities.applied_bypasses.map(
        (bypass) =>
          `${bypass.path}  [removes ${bypass.removed_denies.length ? bypass.removed_denies.join(", ") : "no listed denies"}]`,
      ),
    commands: () => [
      ...capabilities.blocked_commands.map((command) => `blocked  ${command}`),
      ...capabilities.allowed_commands.map((command) => `allowed  ${command}`),
    ],
    domains: () => [...capabilities.allowed_domains],
  }[topic]();
  return [
    `${topic} (${lines.length}):`,
    ...(lines.length ? lines : ["  none"]).map((line) => `  ${line.replace(/^ +/, "")}`),
  ].join("\n");
}

function describe(decision: AccessDecision, access: AccessKind, target: string): string {
  switch (decision.kind) {
    case "granted":
      return `Allowed (${access}): ${decision.path}\nGrant: ${entry(decision.grant)}`;
    case "denied":
      return `Denied: ${decision.path}\nOverlaps denied path ${decision.denied}. Exceptions are listed by /sandbox list exceptions.`;
    case "ungranted":
      return `Not granted (${access}): ${decision.path}\nNo grant covers this path for ${access}.`;
    case "unresolved":
      return `Cannot resolve ${target}: unreadable path or symlink loop. Treated as not granted.`;
  }
}

export function explain(
  capabilities: NonoCapabilities,
  cwd: string,
  target: string,
  access: AccessKind,
  home = homedir(),
): string {
  const expanded =
    target === "~" ? home : target.startsWith("~/") ? join(home, target.slice(2)) : target;
  return `${describe(explainAccess(capabilities, cwd, expanded, access), access, target)}\n${NOTE}`;
}

export type SandboxRequest =
  | { kind: "summary" }
  | { kind: "list"; topic: ListTopic }
  | { kind: "explain"; target: string; access: AccessKind }
  | { kind: "invalid" };

export function parseRequest(args: string): SandboxRequest {
  const words = args.trim().split(/\s+/).filter(Boolean);
  const [command, ...rest] = words;
  if (command === undefined) return { kind: "summary" };
  if (command === "list") {
    const topic = LIST_TOPICS.find((candidate) => candidate === rest[0]);
    return topic && rest.length === 1 ? { kind: "list", topic } : { kind: "invalid" };
  }
  if (command === "explain" && rest.length > 0) {
    const last = rest[rest.length - 1];
    const access = last === "read" || last === "write" ? last : undefined;
    const target = (access ? rest.slice(0, -1) : rest).join(" ");
    return target ? { kind: "explain", target, access: access ?? "write" } : { kind: "invalid" };
  }
  return { kind: "invalid" };
}
