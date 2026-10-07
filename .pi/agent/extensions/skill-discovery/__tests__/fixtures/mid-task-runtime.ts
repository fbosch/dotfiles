import { type AssistantMessage, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createSkillSelectionExtension } from "../../selection";

export default function (pi: ExtensionAPI): void {
  let modelCalls = 0;
  let classifierCalls = 0;
  let sawAdvice = false;
  createSkillSelectionExtension({
    getConfig: () => ({
      enabled: true,
      midTaskEnabled: process.env.PI_SKILL_TEST_INPUT_ONLY !== "1",
      threshold: 0.72,
      timeoutMs: 2400,
      maxRecommendations: 3,
    }),
    getDisabledNames: () => new Set(),
    selectSkillsDetailed: async () => {
      classifierCalls += 1;
      return {
        ok: true,
        value: {
          recommendations: classifierCalls === 1 ? [] : [{ name: "gjs", score: 0.95 }],
          scores: new Map(),
          noMatchScore: classifierCalls === 1 ? 1 : 0,
        },
      };
    },
  })(pi);
  pi.registerTool(
    defineTool({
      name: "fixture_probe",
      label: "Fixture probe",
      description: "Return a local fixture observation",
      parameters: Type.Object({}),
      async execute() {
        return {
          content: [{ type: "text", text: "RAW OUTPUT MUST NOT BE CLASSIFIED" }],
          details: undefined,
          terminate: process.env.PI_SKILL_TEST_TERMINATE === "1",
        };
      },
    }),
  );
  pi.registerProvider("mid-task-fixture", {
    api: "openai-completions",
    baseUrl: "https://fixture.invalid",
    apiKey: "fixture-not-a-real-key",
    models: [
      {
        id: "fixture",
        name: "Fixture",
        input: ["text"],
        reasoning: false,
        contextWindow: 32_000,
        maxTokens: 1_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
    streamSimple(model, context) {
      modelCalls += 1;
      if (modelCalls === 2) sawAdvice = JSON.stringify(context.messages).includes('name=\\"gjs\\"');
      const message: AssistantMessage = {
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: Date.now(),
        content:
          modelCalls === 1
            ? [
                { type: "text", text: "Investigate widget signal lifecycle" },
                { type: "toolCall", id: "probe", name: "fixture_probe", arguments: {} },
              ]
            : [{ type: "text", text: "Done" }],
        stopReason: modelCalls === 1 ? "toolUse" : "stop",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: message });
      stream.push({
        type: "done",
        reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
        message,
      });
      return stream;
    },
  });
  pi.on("agent_settled", (_event, context) => {
    const branch = context.sessionManager.getBranch();
    console.log(
      `MID_TASK_RUNTIME_CHECK ${JSON.stringify({
        modelCalls,
        classifierCalls,
        sawAdvice,
        adviceEntries: branch.filter(
          (entry) =>
            entry.type === "custom_message" && entry.customType === "skill-recommendation-advice",
        ).length,
        chatEntries: branch.filter(
          (entry) => entry.type === "custom" && entry.customType === "skill-recommendations",
        ).length,
      })}`,
    );
  });
}
