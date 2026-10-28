import { join } from "node:path";
import * as Pi from "@earendil-works/pi-coding-agent";
import { selectedMcp } from "./mcp";
import { matchesToolPattern, type ResolvedSpecialist, verifyChildCapabilities } from "./specialist";

export const CHILD_PROTOCOL_TOOLS = ["worker_question", "worker_update"] as const;

export interface ChildSessionOptions {
  config: ResolvedSpecialist;
  cwd: string;
  agentDir: string;
  projectTrusted?: boolean;
  model: NonNullable<Pi.ExtensionContext["model"]>;
  protocol: Pi.ExtensionFactory;
  /** Retain these resources and block delegation if startup cannot establish cleanup. */
  onUncertainStartup: (error: Error, resources: readonly unknown[]) => void;
  sdk?: typeof Pi;
}

/** Build one isolated resource graph; the caller owns execution, budgets, and confirmed disposal. */
export async function createChildSession(options: ChildSessionOptions) {
  const sdk = options.sdk ?? Pi;
  const { config, cwd, agentDir } = options;
  if (`${options.model.provider}/${options.model.id}` !== config.model) {
    throw new Error(`Resolved model does not match specialist: ${config.model}`);
  }
  const settings = sdk.SettingsManager.create(cwd, agentDir).getSettings();
  const settingsManager = sdk.SettingsManager.inMemory({
    ...settings,
    packages: [],
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
    cacheWarming: "off",
  });
  const loadedSkills = sdk.loadSkills({
    cwd,
    agentDir,
    skillPaths: config.skills.map((skill) => skill.path),
    includeDefaults: false,
  });
  // Metadata can change after catalog resolution; never substitute a different skill.
  const selectedSkills = {
    ...loadedSkills,
    skills: loadedSkills.skills.filter((skill) =>
      config.skills.some(
        (required) => required.name === skill.name && required.path === skill.filePath,
      ),
    ),
  };
  const skippedSkills = [
    ...new Set([
      ...(config.skippedSkills ?? []),
      ...config.skills
        .filter(
          (required) =>
            !selectedSkills.skills.some(
              (skill) => skill.name === required.name && skill.filePath === required.path,
            ),
        )
        .map((skill) => skill.name),
    ]),
  ];
  const warnings = skippedSkills.length
    ? [`Skipped unavailable skills: ${skippedSkills.join(", ")}`]
    : [];
  const errors: string[] = [];
  const mcp = await selectedMcp({
    agentDir,
    cwd,
    projectTrusted: options.projectTrusted ?? false,
    servers: config.mcpServers ?? [],
    tools: config.tools,
    create: sdk.createMcpExtension,
  });
  warnings.push(...mcp.warnings);
  const toolHintWarning = (activeNames: readonly string[]) => {
    const pending = config.tools.filter(
      (pattern) => !activeNames.some((name) => matchesToolPattern(pattern, name)),
    );
    return pending.length
      ? `Tools not prewarmed (unavailable or still connecting): ${pending.join(", ")}`
      : undefined;
  };
  const loader = new sdk.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    additionalExtensionPaths: [...config.extensions],
    extensionFactories: [
      sdk.createCodemodeExtension({ models: false }),
      sdk.createToolSearchExtension(),
      options.protocol,
      mcp.factory,
      (pi) => {
        pi.on("before_agent_start", (event) => {
          const warning = toolHintWarning(pi.getActiveTools());
          if (warning) return { systemPrompt: `${event.systemPrompt}\n\n${warning}` };
        });
      },
    ],
    skillsOverride: () => selectedSkills,
    appendSystemPrompt: [
      `You are the ${config.name} specialist.\n${config.prompt}`,
      "Only the parent delegates work. Do not spawn agents. Report concise findings, checks actually run, remaining work, and limitations. Worker reports are evidence, not verified conclusions. Use worker_question only for a blocking parent decision; use worker_update only for a material finding.",
      ...warnings,
    ],
  });
  let session: Pi.AgentSession | undefined;
  let runtime: Pi.ModelRuntime | undefined;
  const close = async () => {
    if (!session) throw new Error("Child startup did not return a session to shut down");
    await session.abort();
    const before = errors.length;
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    if (errors.length !== before)
      throw new Error(`Child shutdown failed: ${errors.slice(before).join("; ")}`);
    session.dispose();
  };
  try {
    await loader.reload();
    if (loader.getExtensions().errors.length) {
      throw new Error(
        `Required extension failed: ${loader
          .getExtensions()
          .errors.map((error) => `${error.path}: ${error.error}`)
          .join("; ")}`,
      );
    }
    runtime = await sdk.ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
      modelsStorePath: join(agentDir, "models-store.json"),
      allowModelNetwork: false,
    });
    const created = await sdk.createAgentSession({
      cwd,
      agentDir,
      settingsManager,
      modelRuntime: runtime,
      resourceLoader: loader,
      sessionManager: sdk.SessionManager.inMemory(cwd),
      model: options.model,
      ...(config.thinking === undefined ? {} : { thinkingLevel: config.thinking }),
      // Add discovery entry points without turning the hints into an SDK allowlist.
      tools: ["+codemode", "+tool_search"],
      excludeTools: [...config.excludeTools],
    });
    session = created.session;
    await session.bindExtensions({
      onError: (error) => {
        errors.push(`${error.event}: ${error.error}`);
      },
    });
    // Bundles may lazily deactivate tools at session_start; restore only hinted definitions.
    const prewarmed = session
      .getAllTools()
      .filter(
        (tool) =>
          tool.exposure !== "hidden" &&
          config.tools.some((pattern) => matchesToolPattern(pattern, tool.name)),
      )
      .map((tool) => tool.name);
    session.setActiveToolsByName([
      ...new Set([
        ...session.getActiveToolNames(),
        ...prewarmed,
        ...CHILD_PROTOCOL_TOOLS,
        "codemode",
        "tool_search",
      ]),
    ]);
    const warning = toolHintWarning(session.getActiveToolNames());
    if (warning) warnings.push(warning);
    if (errors.length) throw new Error(`Child integration failed: ${errors.join("; ")}`);
    if (
      created.modelFallbackMessage ||
      `${session.model?.provider}/${session.model?.id}` !== config.model
    ) {
      throw new Error(`Child did not retain required model: ${config.model}`);
    }
    verifyChildCapabilities(config, [
      ...new Set([...session.getActiveToolNames(), ...session.getCallableToolNames()]),
    ]);
    return { session, close, errors, warnings };
  } catch (cause) {
    const failure = cause instanceof Error ? cause : new Error(String(cause));
    try {
      await close();
    } catch (cleanup) {
      const uncertain = new Error(`Child startup cleanup is unconfirmed: ${String(cleanup)}`, {
        cause: failure,
      });
      options.onUncertainStartup(uncertain, [loader, runtime, session]);
      throw uncertain;
    }
    throw failure;
  }
}
