import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BeforeAgentStartEvent, BeforeAgentStartEventResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { recallSaved, registerRecallPrefetch } from "../recall";
import { sessionWith } from "./fixtures";
import { userStartEvent } from "../../shared/__tests__/agent-start-events";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function setup(texts: string[]) {
  const root = await mkdtemp(join(tmpdir(), "prefetch-evidence-"));
  roots.push(root);
  const { manager, resultIds } = sessionWith(texts.map(() => ({ resultChars: 1000 })));
  const dir = join(root, manager.getSessionId());
  await mkdir(dir);
  const paths: string[] = [];
  for (const [index, content] of texts.entries()) {
    const path = join(dir, `${resultIds[index]}.txt`);
    await writeFile(path, content);
    paths.push(path);
  }
  manager.appendCustomEntry("context-masking", { items: paths.map((path, index) => ({ path, entryId: resultIds[index]!, toolName: "read" })) });
  type Handler = (event: BeforeAgentStartEvent, ctx: ExtensionContext) => Promise<BeforeAgentStartEventResult | undefined>;
  let handler: Handler | undefined;
  registerRecallPrefetch({ on: (_name: string, callback: Handler) => { handler = callback; } } as unknown as Pick<ExtensionAPI, "on">, () => root);
  const invoke = async (prompt: string) => {
    if (!handler) throw Error("Missing prefetch handler");
    return handler(userStartEvent(prompt), { sessionManager: manager } as unknown as ExtensionContext);
  };
  return { manager, root, paths, invoke };
}

test("query echo and search framing cannot outrank nested evidence; manual recall remains literal", async () => {
  const f = await setup([
    'Saved-result search: 2 artifacts\nQuery: What was the archived audit receipt?\noutput: What was the archived audit receipt?',
    'Saved-result search: 1 artifact\nQuery: What was the archived audit receipt?\n5│Archived audit receipt: actual-314',
  ]);
  const result = await f.invoke("What was the archived audit receipt?");
  expect(result?.message?.content).toContain("actual-314");
  expect(result?.message?.content).not.toContain(f.paths[0]);
  expect(result?.message?.content).toContain(f.paths[1]);
  expect((await recallSaved(f.manager.getBranch(), f.root, "archived audit receipt")).passages.length).toBeGreaterThan(0);
});

test("structured data and neighboring lines remain evidence; exact identifier needs one term", async () => {
  const f = await setup([
    '{\n"output": "Archived audit receipt: structured-11"\n}',
    'Archived audit\nreceipt: adjacent-22',
    '"path": "audit-æøå-314"',
  ]);
  expect((await f.invoke("What was the archived audit receipt?"))?.message?.content).toContain("structured-11");
  expect((await f.invoke("What was the archived audit receipt?"))?.message?.content).toContain("adjacent-22");
  expect((await f.invoke("audit-æøå-314"))?.message?.content).toContain("audit-æøå-314");
});

test("deduplicates nested artifacts and balances distinct answers across questions", async () => {
  const f = await setup([
    'Archived audit receipt: shared-314',
    '5│Archived audit receipt: shared-314',
    'Archived audit receipt: alternate-315',
    'Archived audit receipt: audit-only-316\nApproved schema version: schema-7',
  ]);
  const result = await f.invoke("What was the archived audit receipt? Which schema version was approved?");
  const content = String(result?.message?.content);
  expect(content).toContain("schema-7");
  expect(content.split("shared-314").length - 1).toBeLessThanOrEqual(1);
});

test("visible passages are not reinjected when the batch changes; sessions remain isolated", async () => {
  const f = await setup(['Archived audit receipt: visible-314', 'Approved schema version: unseen-7']);
  const first = await f.invoke("What was the archived audit receipt?");
  if (!first?.message) throw Error("Missing prefetch");
  f.manager.appendCustomMessageEntry(first.message.customType, first.message.content, false);
  const next = await f.invoke("What was the archived audit receipt? Which schema version was approved?");
  expect(next?.message?.content).toContain("unseen-7");
  expect(next?.message?.content).not.toContain("visible-314");
  const other = await setup(['Archived audit receipt: visible-314']);
  expect((await other.invoke("What was the archived audit receipt?"))?.message?.content).toContain("visible-314");
});
