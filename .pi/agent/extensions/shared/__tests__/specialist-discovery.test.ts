import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  createToolSearchExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import clipboardExtension from "../../clipboard";
import agentMentions from "../../mentions/agent-mentions";
import { registerParentTools } from "../../subagents/tools";
import typesafeQuestionExtension from "../../typesafe-question";

const specialists = [
  "clipboard_read",
  "clipboard_write",
  "typesafe_question",
  "subagent",
  "subagent_result",
  "subagent_control",
];

test("installed SDK keeps specialists undeclared and discovers them without executing them", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-specialist-discovery-"));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    await mkdir(join(cwd, "agents"));
    await writeFile(
      join(cwd, "agents/fixture.md"),
      "---\ndescription: Fixture specialist\nmax_turns: 6\n---\nFixture role.\n",
    );
    const settingsManager = SettingsManager.inMemory({
      cacheWarming: "off",
      defaultTools: ["+tool_search"],
    });
    const modelRuntime = await ModelRuntime.create({
      authPath: join(cwd, "auth.json"),
      modelsPath: join(cwd, "models.json"),
      modelsStorePath: join(cwd, "models-store.json"),
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: cwd,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        clipboardExtension,
        typesafeQuestionExtension,
        (pi) => {
          registerParentTools(pi, () => {
            throw new Error("Registration and discovery must not launch workers");
          });
        },
        (pi) => agentMentions(pi, cwd),
        createToolSearchExtension(),
      ],
    });
    await loader.reload();
    expect(loader.getExtensions().errors).toEqual([]);
    ({ session } = await createAgentSession({
      cwd,
      agentDir: cwd,
      settingsManager,
      modelRuntime,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(cwd),
    }));
    await session.bindExtensions({
      onError: (error) => {
        throw new Error(JSON.stringify(error));
      },
    });
    const initial = session.getActiveToolNames();
    for (const name of ["read", "bash", "write", "tool_search"]) expect(initial).toContain(name);
    expect(session.getAllTools().filter((tool) => specialists.includes(tool.name))).toHaveLength(
      specialists.length,
    );
    for (const tool of session.getAllTools().filter((tool) => specialists.includes(tool.name))) {
      expect(tool.exposure).toBe("deferred");
      expect(initial).not.toContain(tool.name);
    }
    const routing = await session.extensionRunner.emitBeforeAgentStart(
      { messageType: "user", prompt: "@fixture inspect this task" },
      { cwd },
    );
    expect(
      routing.messages?.some((message) => message.customType === "explicit-subagent-invocation"),
    ).toBe(true);
    const search = session.agent.state.tools.find((tool) => tool.name === "tool_search");
    if (!search) throw new Error("tool_search not initially active");
    for (const name of specialists) {
      const before = session.getActiveToolNames();
      const result = await search.execute(
        `discover-${name}`,
        { query: name, limit: 1 },
        new AbortController().signal,
      );
      expect(result.details).toEqual({ loaded: [name] });
      expect(session.getActiveToolNames().filter((tool) => !before.includes(tool))).toEqual([name]);
    }
  } finally {
    if (session) {
      await session.abort();
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
    }
    await rm(cwd, { recursive: true, force: true });
  }
});
