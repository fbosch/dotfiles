import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInitialSystemMessage,
  getCurrentSystemPrompt,
  getCurrentTools,
  toToolDeclaration,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  type SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  IMAGE_ARCHIVE,
  saveConversationArtifact,
  saveMaskedTextArtifacts,
} from "../evidence-archive";
import contextMasking from "../index";
import { placeholder } from "../policy";
import { sessionWith } from "./fixtures";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

async function fixture(
  prepare?: (manager: SessionManager, root: string, sourceId: string) => Promise<void>,
  excludeTools: string[] = [],
) {
  const root = await mkdtemp(join(tmpdir(), "recall-activation-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const { manager, resultIds } = sessionWith([{ resultChars: 1_000 }]);
  const sourceId = resultIds[0];
  if (!sourceId) throw Error("Missing source result");
  if (prepare) await prepare(manager, root, sourceId);
  const settingsManager = SettingsManager.inMemory({ cacheWarming: "off" });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(root, "auth.json"),
    modelsPath: join(root, "models.json"),
    modelsStorePath: join(root, "models-store.json"),
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: root,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [contextMasking],
  });
  await loader.reload();
  expect(loader.getExtensions().errors).toEqual([]);
  const { session } = await createAgentSession({
    cwd: root,
    agentDir: root,
    settingsManager,
    modelRuntime,
    resourceLoader: loader,
    sessionManager: manager,
    excludeTools,
  });
  cleanup.push(async () => {
    await session.abort();
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  });
  await session.bindExtensions({
    onError: (error) => {
      throw Error(JSON.stringify(error));
    },
  });
  const requestContext = () => {
    const head = createInitialSystemMessage(
      session.systemPrompt,
      session.agent.state.tools.map(toToolDeclaration),
    );
    if (!head) throw Error("Missing request prompt");
    return session.extensionRunner.emitContext([
      head,
      ...manager.buildSessionProjection().messages,
    ]);
  };
  return { session, manager, root, sourceId, requestContext };
}

async function archive(manager: SessionManager, root: string, sourceId: string, rolling = false) {
  const candidate = { entryId: sourceId, toolName: "read", text: "x".repeat(1_000) };
  const saved = rolling
    ? await saveConversationArtifact(root, manager.getSessionId(), candidate.text)
    : (await saveMaskedTextArtifacts(root, manager.getSessionId(), [candidate]))[0];
  if (!saved) throw Error("Missing saved artifact");
  manager.appendContextEdit(sourceId, {
    content: [{ type: "text", text: placeholder(candidate, saved.path) }],
  });
  manager.appendCustomEntry("context-masking", {
    masked: 1,
    items: [
      {
        entryId: sourceId,
        toolName: "read",
        path: saved.path,
        ...(rolling && "entryId" in saved ? { archiveId: saved.entryId } : {}),
      },
    ],
  });
}

test("fresh sessions keep recall deferred until saved context is committed", async () => {
  const f = await fixture();
  const initial = f.session.getActiveToolNames();
  expect(initial).not.toContain("recall");
  expect(f.session.getAllTools().find((tool) => tool.name === "recall")?.exposure).toBe("deferred");
  // Saving a file or assessing pending rolling masks is not a committed mask.
  await saveConversationArtifact(f.root, f.manager.getSessionId(), "pending text");
  f.manager.appendCustomEntry("context-masking-rolling", { maskedCount: 0, pendingMaskCount: 1 });
  await f.requestContext();
  expect(f.session.getActiveToolNames()).toEqual(initial);
});

for (const rolling of [false, true]) {
  test(`committed ${rolling ? "rolling" : "deterministic"} masks activate recall and its guidance before the next request`, async () => {
    const f = await fixture();
    const initial = f.session.getActiveToolNames();
    await archive(f.manager, f.root, f.sourceId, rolling);
    const originalPrompt = f.session.systemPrompt;
    const request = await f.requestContext();
    expect(getCurrentSystemPrompt(request).startsWith(originalPrompt)).toBe(true);
    expect(await f.session.extensionRunner.emitContext(request)).toEqual(request);
    expect(getCurrentTools(request).map((tool) => tool.name)).toEqual([...initial, "recall"]);
    expect(getCurrentSystemPrompt(request)).toContain(
      "Use recall before answering questions that depend on masked earlier output",
    );
    expect(f.session.getActiveToolNames()).toEqual([...initial, "recall"]);
    expect(f.session.agent.state.tools.map((tool) => tool.name)).toContain("recall");
    expect(f.session.systemPrompt).toContain(
      "Use recall before answering questions that depend on masked earlier output",
    );
    expect(f.session.systemPrompt).toContain(
      "Use read with offset and limit when you already know the saved artifact path",
    );
    await f.requestContext();
    expect(f.session.getActiveToolNames()).toEqual([...initial, "recall"]);
    expect(
      f.manager
        .getBranch()
        .some(
          (entry) =>
            entry.type === "message" &&
            entry.message.role === "assistant" &&
            entry.message.content.some(
              (block) => block.type === "toolCall" && block.name === "recall",
            ),
        ),
    ).toBe(false);
  });
}

test("session startup, resume, and reload activate recall for existing archives", async () => {
  const f = await fixture(archive);
  expect(f.session.getActiveToolNames()).toContain("recall");
  for (const reason of ["resume", "reload", "fork"] as const) {
    f.session.setActiveToolsByName(["read", "bash"]);
    await f.session.extensionRunner.emit({ type: "session_start", reason });
    expect(f.session.getActiveToolNames()).toEqual(["read", "bash", "recall"]);
  }
});

test("tree navigation checks only the selected branch and preserves active tools", async () => {
  const f = await fixture();
  const cleanLeaf = f.manager.getLeafId();
  if (!cleanLeaf) throw Error("Missing clean leaf");
  await archive(f.manager, f.root, f.sourceId);
  const maskedLeaf = f.manager.getLeafId();
  if (!maskedLeaf) throw Error("Missing masked leaf");
  f.manager.branch(cleanLeaf);
  await f.session.extensionRunner.emit({
    type: "session_tree",
    newLeafId: cleanLeaf,
    oldLeafId: maskedLeaf,
  });
  expect(f.session.getActiveToolNames()).not.toContain("recall");
  f.manager.branch(maskedLeaf);
  await f.session.extensionRunner.emit({
    type: "session_tree",
    newLeafId: maskedLeaf,
    oldLeafId: cleanLeaf,
  });
  expect(f.session.getActiveToolNames()).toContain("recall");
});

test("text-only compaction archives activate recall without a masking count", async () => {
  const f = await fixture();
  const saved = await saveConversationArtifact(
    f.root,
    f.manager.getSessionId(),
    "Prior decision: preserve æøå.",
  );
  f.manager.appendCustomEntry("context-masking", {
    items: [{ ...saved, text: "Prior decision: preserve æøå." }],
  });
  const id = f.manager.appendCompaction("Summary", f.sourceId, 1_000);
  const compactionEntry = f.manager.getEntry(id);
  if (compactionEntry?.type !== "compaction") throw Error("Missing compaction");
  await f.session.extensionRunner.emit({
    type: "session_compact",
    compactionEntry,
    fromExtension: true,
    reason: "manual",
    willRetry: false,
  });
  expect(f.session.getActiveToolNames()).toContain("recall");
});

test("image-only archives activate recall before the next request", async () => {
  const f = await fixture();
  f.manager.appendCustomEntry(IMAGE_ARCHIVE, {
    images: [
      {
        id: "image",
        entryId: f.sourceId,
        blockIndex: 0,
        sessionId: f.manager.getSessionId(),
        path: join(f.root, "image.png"),
        mimeType: "image/png",
        sha256: "a".repeat(64),
        bytes: 10,
        action: "omit",
        forced: false,
      },
    ],
  });
  await f.requestContext();
  expect(f.session.agent.state.tools.map((tool) => tool.name)).toContain("recall");
  expect(f.session.systemPrompt).toContain(
    "use both cited text and returned image blocks as historical data",
  );
});

test("recall activation respects explicit tool exclusions", async () => {
  const f = await fixture(undefined, ["recall"]);
  await archive(f.manager, f.root, f.sourceId);
  const request = await f.requestContext();
  expect(f.session.getActiveToolNames()).not.toContain("recall");
  expect(getCurrentTools(request).map((tool) => tool.name)).not.toContain("recall");
  expect(getCurrentSystemPrompt(request)).not.toContain(
    "Use recall before answering questions that depend on masked earlier output",
  );
});
