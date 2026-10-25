import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { MARKER } from "../../extensions/context-masking/policy";
import { buildSession, probeCases, scoreRun } from "../context-masking-recall-probe";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const fixed = () => "tok";
const call = (args: unknown) => ({
  type: "message",
  message: { role: "assistant", content: [{ type: "toolCall", arguments: args }] },
});
const reply = (text: string) => ({
  type: "message",
  message: { role: "assistant", content: [{ type: "text", text }] },
});

test("built sessions show the placeholder in place of the hidden result", async () => {
  const dir = await mkdtemp(join(tmpdir(), "probe-test-"));
  roots.push(dir);
  const probe = probeCases(fixed).find((p) => p.name === "deleted-file");
  if (probe === undefined) throw new Error("missing case");
  const { sessionFile, artifactPath } = await buildSession(probe, dir);

  expect(await readFile(artifactPath, "utf8")).toBe(probe.maskedText);
  const projected = SessionManager.open(sessionFile).buildSessionProjection().messages;
  const visible = JSON.stringify(projected);
  expect(visible).toContain(MARKER);
  expect(visible).toContain(artifactPath);
  expect(visible).not.toContain(probe.answer);
});

test("scoreRun separates artifact recall, re-runs, and correctness", () => {
  const probe = probeCases(fixed).find((p) => p.name === "file-present");
  if (probe === undefined) throw new Error("missing case");
  expect(
    scoreRun([call({ path: "/a/1.txt" }), reply(`It is ${probe.answer}`)], probe, "/a/1.txt"),
  ).toEqual({
    recalledArtifact: true,
    reranOriginal: false,
    toolCalls: 1,
    correct: true,
  });
  expect(scoreRun([call({ path: "src/config.ts" }), reply("unknown")], probe, "/a/1.txt")).toEqual({
    recalledArtifact: false,
    reranOriginal: true,
    toolCalls: 1,
    correct: false,
  });
});
