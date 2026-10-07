import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ClassifierContext, ClassifierResult, Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { match } from "ts-pattern";
import { Type } from "typebox";

const ALLOWED_TOOLS = new Set(["read", "skill_search", "progress"]);
const MAX_TOOL_CALLS = 24;
const ADVISORY_MARKER =
  "These are advisory recommendations, not skill loads or new mandatory rules.";

function usageSummary(usage: Usage | undefined) {
  if (usage === undefined) return undefined;
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    totalTokens: usage.totalTokens,
  };
}

function answerMatchesQuestion(
  answer: ClassifierResult["answers"][string],
  question: ClassifierContext["questions"][string],
): boolean {
  return match(answer)
    .with(
      { type: "bool" },
      (value) =>
        question.type === "bool" &&
        Number.isFinite(value.probability) &&
        value.probability >= 0 &&
        value.probability <= 1,
    )
    .with({ type: "choice" }, (value) => {
      if (question.type !== "choice") return false;
      const keys = Object.keys(question.criteria);
      const probabilities = Object.entries(value.probabilities);
      const total = probabilities.reduce((sum, [, probability]) => sum + probability, 0);
      return (
        keys.includes(value.choice) &&
        probabilities.length === keys.length &&
        keys.every((key) => {
          const probability = value.probabilities[key];
          return (
            typeof probability === "number" &&
            Number.isFinite(probability) &&
            probability >= 0 &&
            probability <= 1
          );
        }) &&
        Math.abs(total - 1) <= 0.02 &&
        probabilities.every(
          ([, probability]) => Number.isFinite(probability) && probability >= 0 && probability <= 1,
        ) &&
        probabilities.every(
          ([key, probability]) =>
            probability <= (value.probabilities[value.choice] ?? 0) || key === value.choice,
        ) &&
        Number.isFinite(value.confidence) &&
        value.confidence >= 0 &&
        value.confidence <= 1
      );
    })
    .with(
      { type: "score" },
      (value) =>
        question.type === "score" &&
        Number.isFinite(value.score) &&
        value.score >= 0 &&
        value.score <= question.criteria.length - 1 &&
        Number.isFinite(value.confidence) &&
        value.confidence >= 0 &&
        value.confidence <= 1,
    )
    .exhaustive();
}

function validClassifierResponse(input: ClassifierContext, result: ClassifierResult): boolean {
  const questions = Object.entries(input.questions);
  const answers = Object.entries(result.answers);
  return (
    questions.length === answers.length &&
    questions.every(([id, question]) => {
      const answer = result.answers[id];
      return answer !== undefined && answerMatchesQuestion(answer, question);
    })
  );
}

function textBlocks(message: AgentMessage): string {
  if (!("content" in message)) return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function recommendationNames(text: string): string[] {
  if (!text.includes(ADVISORY_MARKER)) return [];
  return [
    ...new Set([...text.matchAll(/<skill name="([a-z0-9-]+)"/gu)].map((match) => match[1] ?? "")),
  ].filter(Boolean);
}

function activityFlags(text: string) {
  const normalized = text.toLowerCase();
  return {
    mentionsRestore: /\brestore\b/u.test(normalized),
    mentionsVerification: /\bverif(?:y|ied|ication)\b|\bchecksum\b/u.test(normalized),
    mentionsHandoff: /\bhandoff\b/u.test(normalized),
    mentionsOwner: /\bowner\b/u.test(normalized),
    mentionsOpenWork: /\b(?:open|pending|remaining|not complete)\b/u.test(normalized),
  };
}

export default function skillSuggestionsFixture(pi: ExtensionAPI): void {
  const trace = process.env.SKILL_SUGGESTIONS_TRACE;
  const work = process.env.SKILL_SUGGESTIONS_WORK;
  const skillRoot = process.env.SKILL_SUGGESTIONS_SKILL_ROOT;
  const task = process.env.SKILL_SUGGESTIONS_TASK;
  const arm = process.env.SKILL_SUGGESTIONS_ARM;
  const model = process.env.SKILL_SUGGESTIONS_MODEL;
  const thinking = process.env.SKILL_SUGGESTIONS_THINKING;
  const warmSkills = process.env.SKILL_SUGGESTIONS_WARM_SKILLS?.split(",").filter(Boolean) ?? [];
  const coldSkills = process.env.SKILL_SUGGESTIONS_COLD_SKILLS?.split(",").filter(Boolean) ?? [];
  if (!trace || !work || !skillRoot || !task || !arm || !model || !thinking) {
    throw new Error("Use the isolated skill-suggestions launcher");
  }

  const workRoot = realpathSync(work);
  const skillsRoot = realpathSync(skillRoot);
  let phase: "input" | "mid-task" | "skill_search" | "agent" = "agent";
  let toolCalls = 0;
  let searchCalls = 0;
  let requestStartedAt: number | undefined;
  const seenRecommendations = new Set<string>();
  const record = (kind: string, data: Record<string, unknown> = {}) =>
    appendFileSync(trace, `${JSON.stringify({ kind, task, arm, ...data })}\n`, { mode: 0o600 });

  pi.on("session_start", (_event, context) => {
    const registry = context.modelRegistry;
    const original = registry.classify.bind(registry);
    registry.classify = async (classifierModel, input, options) => {
      const callPhase = phase;
      const startedAt = performance.now();
      try {
        const result = await original(classifierModel, input, options);
        record("classifier", {
          phase: callPhase,
          provider: classifierModel.provider,
          model: classifierModel.id,
          elapsedMs: Math.round(performance.now() - startedAt),
          stopReason: result.stopReason,
          validResponse: result.stopReason === "stop" && validClassifierResponse(input, result),
          usage: usageSummary(result.usage),
        });
        return result;
      } catch {
        record("classifier", {
          phase: callPhase,
          provider: classifierModel.provider,
          model: classifierModel.id,
          elapsedMs: Math.round(performance.now() - startedAt),
          stopReason: "throw",
          validResponse: false,
        });
        throw new Error("Classifier request failed");
      }
    };
  });

  pi.registerTool({
    name: "read",
    label: "Read fixture file",
    description:
      "Read one task file or a discovered skill's SKILL.md. Only fixture and skill files are available.",
    promptSnippet: "Read an allowed task file or skill instruction file",
    parameters: Type.Object({ path: Type.String() }),
    async execute(id, params, signal) {
      signal?.throwIfAborted();
      if (++toolCalls > MAX_TOOL_CALLS) throw new Error("Fixture tool budget exceeded");
      const path = realpathSync(resolve(workRoot, params.path));
      const workspaceRead = path.startsWith(`${workRoot}${sep}`);
      const skillRead =
        path.startsWith(`${skillsRoot}${sep}`) &&
        basename(path) === "SKILL.md" &&
        relative(skillsRoot, path).split(sep).length === 2;
      if (!workspaceRead && !skillRead) {
        record("denied-read", { callId: id });
        throw new Error("Read is limited to fixture files and skill instructions");
      }
      const text = readFileSync(path, "utf8");
      record("read", {
        callId: id,
        scope: skillRead ? "skill" : "workspace",
        ...(skillRead
          ? { skill: relative(skillsRoot, path).split(sep)[0] }
          : { path: relative(workRoot, path) }),
      });
      return {
        content: [
          {
            type: "text",
            text: `File: ${relative(skillRead ? skillsRoot : workRoot, path)}\n${text}`,
          },
        ],
        details: undefined,
      };
    },
  });

  pi.registerTool({
    name: "progress",
    label: "Record progress",
    description: "Record a short progress update before continuing a multi-step fixture task.",
    promptSnippet: "Record a brief progress update before continuing",
    parameters: Type.Object({ note: Type.String({ maxLength: 600 }) }),
    async execute(id, params, signal) {
      signal?.throwIfAborted();
      if (++toolCalls > MAX_TOOL_CALLS) throw new Error("Fixture tool budget exceeded");
      record("progress", { callId: id, ...activityFlags(params.note) });
      return { content: [{ type: "text", text: "Progress noted." }], details: undefined };
    },
  });

  pi.on("tool_call", (event) => {
    if (!ALLOWED_TOOLS.has(event.toolName)) {
      record("denied-tool", { toolName: event.toolName });
      return { block: true, reason: "Tool is outside the skill-suggestions fixture allowlist" };
    }
    if (event.toolName === "skill_search") {
      if (++searchCalls > 6) {
        record("search-budget-exceeded");
        return { block: true, reason: "Skill search budget exceeded" };
      }
      phase = "skill_search";
      record("skill-search", { callId: event.toolCallId });
    }
    return undefined;
  });

  pi.on("tool_result", (event) => {
    if (event.toolName !== "skill_search") return;
    const text = event.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const matches = [
      ...new Set([...text.matchAll(/^- ([a-z0-9-]+):/gmu)].map((match) => match[1] ?? "")),
    ].filter(Boolean);
    record("skill-search-result", { matches, isError: event.isError });
  });

  pi.on("before_agent_start", (event, context) => {
    phase = "input";
    record("execution", {
      model: context.model ? `${context.model.provider}/${context.model.id}` : null,
      thinking: context.thinkingLevel ?? pi.getThinkingLevel(),
      promptLength: event.prompt.length,
      tools: pi.getActiveTools(),
      skillSelectionEnabled: arm === "treatment",
    });
  });

  pi.on("turn_end", (event) => {
    if (event.message.role !== "assistant") return;
    const visible = event.message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    record("visible-activity", {
      toolDriven: event.message.stopReason === "toolUse",
      ...activityFlags(visible),
    });
    if (event.message.stopReason === "toolUse") phase = "mid-task";
  });

  pi.on("context_with_system", (event, context) => {
    const allText = event.messages.map(textBlocks).join("\n");
    const systemText = context.getSystemPrompt();
    const recommendations = recommendationNames(allText);
    const newlyRecommended = recommendations.filter((name) => !seenRecommendations.has(name));
    for (const name of recommendations) seenRecommendations.add(name);
    const catalogVisibility = Object.fromEntries(
      [...warmSkills, ...coldSkills].map((name) => [name, systemText.includes(name)]),
    );
    record("context", {
      phase,
      newRecommendations: newlyRecommended,
      allRecommendations: recommendations,
      advisoryPresent: allText.includes(ADVISORY_MARKER),
      catalogVisibility,
    });
    phase = "agent";
  });

  pi.on("before_provider_request", () => {
    requestStartedAt = performance.now();
  });

  pi.on("message_end", (event, context) => {
    if (event.message.role !== "assistant") return;
    const text = event.message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const hasToolCalls = event.message.content.some((block) => block.type === "toolCall");
    const elapsedMs =
      requestStartedAt === undefined ? undefined : Math.round(performance.now() - requestStartedAt);
    requestStartedAt = undefined;
    record("assistant", {
      stopReason: event.message.stopReason,
      hasToolCalls,
      text: hasToolCalls ? undefined : text.slice(0, 4_000),
      elapsedMs,
      usage: usageSummary(event.message.usage),
      model: context.model ? `${context.model.provider}/${context.model.id}` : null,
      thinking: context.thinkingLevel ?? pi.getThinkingLevel(),
    });
  });

  pi.on("turn_start", (event, context) => {
    if (event.turnIndex <= 14) return;
    record("budget-exceeded", { turnIndex: event.turnIndex });
    context.abort();
  });
}
