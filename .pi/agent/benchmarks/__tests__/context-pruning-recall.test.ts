import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  ARMS,
  buildHistory,
  chooseKept,
  history,
  questions,
  TASK,
} from "../context-pruning-recall";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const scores = [0.1, 0.9, 0.1, 1, 0.1, 0.1, 0.1, 0.1];

test("compares equal-size classifier and recency retention with deterministic masking", () => {
  expect([...chooseKept("classifier", scores, 8)]).toEqual([3, 1]);
  expect([...chooseKept("recency", scores, 8)]).toEqual([7, 6]);
  expect(chooseKept("deterministic", scores, 8).size).toBe(0);
  expect(chooseKept("inline", scores, 8).size).toBe(8);
  expect(history().observations.every((o) => o.text.length === 4_000)).toBe(true);
});

test("keeps every omitted result exact and recallable, including surprising future requests", async () => {
  const h = history(() => "fixed-token");
  const root = await mkdtemp(join(tmpdir(), "pruning-test-"));
  roots.push(root);
  const sizes: Record<string, number> = {};
  for (const arm of ARMS) {
    const built = await buildHistory(h, arm, scores, join(root, arm));
    const visible = JSON.stringify(
      SessionManager.open(built.sessionFile).buildSessionProjection().messages,
    );
    sizes[arm] = built.contextChars;
    for (const [i, observation] of h.observations.entries()) {
      const artifact = built.artifacts[i];
      if (!artifact) throw new Error("Missing exact artifact");
      expect(await readFile(artifact, "utf8")).toBe(observation.text);
      if (!built.kept.includes(i)) expect(visible).toContain(artifact);
    }
    expect(visible.includes(h.diagnosis)).toBe(arm === "inline" || arm === "classifier");
    expect(visible.includes(h.surprise)).toBe(arm === "inline");
    expect(visible).toContain("checks/check-9.txt");
  }
  expect(sizes.classifier).toBeLessThan(sizes.inline ?? 0);
  expect(sizes.deterministic).toBeLessThan(sizes.classifier ?? 0);
});

test("future questions are separate from the classifier's original task", () => {
  const h = history(() => "fixed-token");
  expect(TASK).not.toContain(h.diagnosis);
  expect(questions(h).map((q) => q.name)).toEqual(["diagnosis", "decision", "surprise", "control"]);
  expect(questions(h).find((q) => q.name === "surprise")?.answer).toBe(h.surprise);
});
