import { afterEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConversationArtifact } from "../evidence-archive";
import { RECALL_LIMITS, recallSaved, recallSavedBatch } from "../recall";
import { sessionWith } from "./fixtures";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

test("finds older compaction snapshots before the bounded disk scan", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "recall-history-")));
  roots.push(root);
  const { manager } = sessionWith([]);
  const texts = [
    "Cookie decoder fixture: expected plain value, apiUrl=https://api.example.com.",
    "Approved IPC capabilities location: modules/nono/ipc-capabilities.json.",
    ...Array.from({ length: 100 }, (_, i) => `Unrelated completed health check ${i}: passed.`),
  ];
  const items = [];
  for (const text of texts)
    items.push({ ...(await saveConversationArtifact(root, manager.getSessionId(), text)), text });
  manager.appendCustomEntry("context-masking", { items });
  const report = await recallSaved(
    manager.getBranch(),
    root,
    "What value did the cookie decoder fixture expect?",
    3,
  );
  expect(report.passages.some((passage) => passage.text.includes("plain value"))).toBe(true);
  expect(report.scanned).toBeLessThanOrEqual(RECALL_LIMITS.artifacts);
  const batch = await recallSavedBatch(
    manager.getBranch(),
    root,
    [
      "What value did the cookie decoder fixture expect?",
      "Where was the approved IPC capabilities location?",
    ],
    3,
  );
  expect(batch.queries[0]?.passages.some((p) => p.text.includes("plain value"))).toBe(true);
  expect(batch.queries[1]?.passages.some((p) => p.text.includes("ipc-capabilities.json"))).toBe(
    true,
  );
});

test("command-output questions retain short stdout in large codemode batches", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "recall-stdout-")));
  roots.push(root);
  const { manager, resultIds } = sessionWith([
    {
      resultChars: 0,
      tool: "codemode",
      nestedCalls: {
        calls: [{ id: "inner", name: "bash", arguments: { command: "hostname" }, status: "ok" }],
        complete: true,
      },
    },
  ]);
  const text =
    "Script completed\nWall time 0.1 seconds\nOutput:\n\n==> text 1/2 <==\n" +
    JSON.stringify({ i: 0, result: { output: "node-zeta\n", exit_code: 0 } }) +
    "\n==> text 2/2 <==\n" +
    "Sandbox command investigation output documentation.\n".repeat(150);
  const saved = await saveConversationArtifact(root, manager.getSessionId(), text);
  const entryId = resultIds[0];
  if (!entryId) throw Error("Missing tool result");
  manager.appendCustomEntry("context-masking", {
    items: [{ ...saved, entryId, archiveId: saved.entryId, toolName: "codemode", text }],
  });
  const report = await recallSaved(
    manager.getBranch(),
    root,
    "What did the hostname command print during the sandbox investigation?",
    3,
  );
  expect(report.passages.some((p) => p.text.includes("node-zeta"))).toBe(true);
});

test("a matched declaration retains nearby configuration values", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "recall-declaration-")));
  roots.push(root);
  const { manager } = sessionWith([]);
  const text =
    "import { getCookie } from '../getCookie';\n\nconst clientConfig = {\n  tenant: '',\n  version: '',\n  region: '',\n  mode: '',\n  apiUrl: 'https://service.example.test',\n};";
  const saved = await saveConversationArtifact(root, manager.getSessionId(), text);
  manager.appendCustomEntry("context-masking", { items: [{ ...saved, text }] });
  const report = await recallSaved(
    manager.getBranch(),
    root,
    "What apiUrl was configured in the getCookie test clientConfig fixture?",
    3,
  );
  expect(report.passages.some((p) => p.text.includes("https://service.example.test"))).toBe(true);
});
