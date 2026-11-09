import { afterEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConversationArtifact } from "../evidence-archive";
import { recallSaved, recallSavedBatch } from "../recall";
import { sessionWith } from "./fixtures";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

test("finds older compaction snapshots across the full archive catalog", async () => {
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
  expect(report.scanned).toBe(texts.length);
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

test("original argument catalogues preserve serialized code instead of decoding it as stdout", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "recall-arguments-")));
  roots.push(root);
  const { manager } = sessionWith([]);
  const args = {
    code: `const approval_token = "approved_æøå";\n${Array.from({ length: 24 }, (_, i) => `const detail_${i} = ${i};`).join("\n")}\nreturn approval_token;`,
  };
  const call = `[tool call codemode] ${JSON.stringify(args)}`;
  const text = `${call}\n`;
  const record = await saveConversationArtifact(root, manager.getSessionId(), text);
  manager.appendCustomEntry("context-masking", {
    items: [{ ...record, toolName: "compaction:calls", text }],
  });
  const result = await recallSaved(
    manager.getBranch(),
    root,
    "exact JSON arguments codemode approval_token approved_æøå",
    3,
  );
  expect(result.passages.some((p) => p.text.includes(JSON.stringify(args)))).toBe(true);
});
