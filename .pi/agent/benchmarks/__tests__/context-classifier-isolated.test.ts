import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import {
  isolatedResources,
  isolatedSession,
  isolatedSettings,
} from "../context-classifier-isolated";

test("isolated loader registers one real compactor and keeps native recall deferred", async () => {
  const root = await mkdtemp(join(tmpdir(), "classifier-isolated-loader-"));
  const cwd = join(root, "work"),
    agentDir = join(root, "agent");
  await mkdir(cwd);
  await mkdir(agentDir);
  try {
    await writeFile(join(agentDir, "settings.json"), JSON.stringify(isolatedSettings()));
    const loader = await isolatedResources(cwd, agentDir);
    const loaded = loader.getExtensions();
    expect(loaded.errors).toHaveLength(0);
    const handlers = loaded.extensions.flatMap(
      (e) => e.handlers.get("session_before_compact") ?? [],
    );
    expect(handlers).toHaveLength(1);
    const tools = loaded.extensions.flatMap((e) => [...e.tools.values()].map((t) => t.definition));
    expect(tools.find((t) => t.name === "recall")?.exposure).toBe("deferred");
    expect(tools.some((t) => t.name === "tool_search")).toBe(true);
    expect(loader.getAgentsFiles().agentsFiles).toHaveLength(0);
    expect(loader.getSkills().skills).toHaveLength(0);
    expect(isolatedSettings().contextMasking.prefetchRecall).toBe(false);
    expect(isolatedSettings().contextClassifierCompaction.enabled).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native session discovers and activates recall without provider requests", async () => {
  const root = await mkdtemp(join(tmpdir(), "classifier-isolated-discovery-"));
  const cwd = join(root, "work"),
    agentDir = join(root, "agent");
  await mkdir(cwd);
  await mkdir(agentDir);
  try {
    const runtime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: null,
      modelsStorePath: join(agentDir, "model-store"),
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    const model = runtime.getModel("openai", "gpt-4.1-mini");
    if (!model) throw new Error("Static SDK test model unavailable");
    const { session } = await isolatedSession(
      cwd,
      agentDir,
      runtime,
      model,
      SessionManager.inMemory(cwd),
    );
    try {
      await session.bindExtensions({});
      expect(session.getActiveToolNames()).toEqual(["tool_search"]);
      expect(session.getAllTools().some((t) => t.name === "recall")).toBe(true);
      const search = session.agent.state.tools.find((t) => t.name === "tool_search");
      if (!search) throw new Error("Native tool discovery missing");
      const result = await search.execute(
        "offline-discovery",
        { query: "recall saved tool output", limit: 1 },
        new AbortController().signal,
      );
      expect(result.content.some((c) => c.type === "text" && c.text.includes("recall"))).toBe(true);
      expect(session.getActiveToolNames()).toContain("recall");
    } finally {
      session.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
