import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createNativeClassifierRegistry } from "../../../lib/__tests__/native-classifier-registry";
import { isRecord } from "../../shared/is-record";
import {
  createSubagentCheckpointAssessor,
  SUBAGENT_CHECKPOINT_TOOL_NAME,
  type SubagentCheckpointInput,
} from "../checkpoint";
import recommendAgentExtension from "../index";

const choices = ["continue", "narrow", "redirect", "escalate", "abstain"] as const;
const input: SubagentCheckpointInput = {
  agentId: "implementer-1",
  assignment: "Implement the export summary.",
  acceptanceCriteria: ["Summary is available from the export command."],
  currentScope: "Working on the CLI output formatting.",
  recentProgress: "The core formatter is implemented; integration is pending.",
  checkpointKind: "material-finding",
};

const registry = await createNativeClassifierRegistry();

function responseFor(choice: (typeof choices)[number], probability = 0.8): Response {
  const probabilities = Object.fromEntries(
    choices.map((candidate) => [
      candidate,
      candidate === choice ? probability : (1 - probability) / (choices.length - 1),
    ]),
  );
  return new Response(
    JSON.stringify({
      answers: { checkpoint: { type: "choice", choice, probabilities, confidence: probability } },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  const body = JSON.parse(String(init?.body)) as unknown;
  if (!isRecord(body)) throw new Error("Expected a JSON request object");
  return body;
}

describe("assess_subagent_checkpoint", () => {
  test("returns a typed probability distribution and fixed advice for every action", async () => {
    const advice = {
      continue:
        "Continue the current scope and check remaining work against the acceptance criteria.",
      narrow: "Keep the goal, but defer nonessential scope.",
      redirect: "Give the worker a bounded correction tied to the assignment and evidence.",
      escalate: "Resolve the blocker or make the required decision at the parent level.",
    } as const;

    for (const decision of ["continue", "narrow", "redirect", "escalate"] as const) {
      const assess = createSubagentCheckpointAssessor({
        fetch: async () => responseFor(decision),
      });
      const result = await assess(input, registry);
      expect(result).toMatchObject({
        status: "assessed",
        decision,
        confidence: 0.8,
        advice: advice[decision],
        duplicate: false,
      });
      if (result.status !== "assessed") throw new Error("Expected an assessment");
      expect(Object.keys(result.probabilities).sort()).toEqual([...choices].sort());
      expect(result.probabilities[decision]).toBe(0.8);
    }
  });

  test("preserves the model's abstain outcome with its probabilities", async () => {
    const assess = createSubagentCheckpointAssessor({ fetch: async () => responseFor("abstain") });
    const result = await assess(input, registry);

    expect(result).toMatchObject({ status: "abstain", confidence: 0.8, duplicate: false });
    if (result.status !== "abstain") throw new Error("Expected an abstention");
    expect(result.probabilities.abstain).toBe(0.8);
    expect(result.advice).toContain("No recommendation");
  });

  test("sends bounded best-effort-redacted state without returning its contents", async () => {
    let sent: Record<string, unknown> | undefined;
    const sensitiveInput: SubagentCheckpointInput = {
      ...input,
      assignment: "Read /Users/fbb/dotfiles/config.ts before changing the exporter.",
      currentScope: "Checking https://alice:password@internal.example/path.",
      recentProgress: "Bearer supersecret token=private-secret OPENAI_API_KEY=another-secret",
    };
    const assess = createSubagentCheckpointAssessor({
      fetch: async (_url, init) => {
        sent = requestBody(init);
        return responseFor("continue");
      },
    });
    const result = await assess(sensitiveInput, registry);
    const serializedRequest = JSON.stringify(sent);
    const serializedResult = JSON.stringify(result);

    expect(serializedRequest).toContain("[redacted-path]");
    expect(serializedRequest).toContain("[redacted-credential]");
    expect(serializedRequest).toContain("token=[redacted]");
    expect(serializedRequest).toContain("OPENAI_API_KEY=[redacted]");
    expect(serializedRequest).toContain("https://[redacted]@internal.example/path");
    for (const secret of [
      "/Users/fbb/dotfiles",
      "supersecret",
      "private-secret",
      "another-secret",
      "alice:password",
    ]) {
      expect(serializedRequest).not.toContain(secret);
      expect(serializedResult).not.toContain(secret);
    }
    expect(Buffer.byteLength(serializedRequest, "utf8")).toBeLessThan(12_000);
  });

  test("rejects over-bound or malformed inputs before provider auth or fetch", async () => {
    let authCalls = 0;
    let fetchCalls = 0;
    const noAuthRegistry = {
      findOfType: registry.findOfType.bind(registry),
      classify: async (...args: Parameters<typeof registry.classify>) => {
        authCalls += 1;
        return registry.classify(...args);
      },
    };
    const assess = createSubagentCheckpointAssessor({
      fetch: async () => {
        fetchCalls += 1;
        return responseFor("continue");
      },
    });
    const invalidInputs: unknown[] = [
      { ...input, agentId: "../review" },
      { ...input, agentId: `a${"b".repeat(64)}` },
      { ...input, assignment: "x".repeat(1_001) },
      { ...input, acceptanceCriteria: Array(7).fill("criterion") },
      { ...input, checkpointKind: "routine-update" },
      { ...input, extra: "not accepted" },
    ];

    for (const invalid of invalidInputs) {
      expect(await assess(invalid, noAuthRegistry)).toMatchObject({
        status: "unavailable",
        reason: "invalid-input",
      });
    }
    expect(authCalls).toBe(0);
    expect(fetchCalls).toBe(0);
  });

  test("deduplicates concurrent and repeated identical checkpoint inputs", async () => {
    let fetchCalls = 0;
    const assess = createSubagentCheckpointAssessor({
      fetch: async () => {
        fetchCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return responseFor("narrow");
      },
    });
    const [first, duplicate] = await Promise.all([
      assess(input, registry),
      assess(input, registry),
    ]);
    const repeated = await assess(input, registry);

    expect(fetchCalls).toBe(1);
    expect(first).toMatchObject({ status: "assessed", decision: "narrow", duplicate: false });
    expect(duplicate).toMatchObject({ status: "assessed", decision: "narrow", duplicate: true });
    expect(repeated).toMatchObject({ status: "assessed", decision: "narrow", duplicate: true });
  });

  test("fails open on Classifier unavailability and cancellation", async () => {
    const unavailable = createSubagentCheckpointAssessor({
      fetch: async () => new Response("{}", { status: 503 }),
    });
    expect(await unavailable(input, registry)).toMatchObject({
      status: "unavailable",
      reason: "classifier-unavailable",
    });

    const controller = new AbortController();
    let markFetchStarted: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const cancellable = createSubagentCheckpointAssessor({
      fetch: async (_url, init) =>
        await new Promise<Response>((_resolve, reject) => {
          markFetchStarted?.();
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    });
    const pending = cancellable(input, registry, controller.signal);
    await fetchStarted;
    controller.abort();

    expect(await pending).toMatchObject({ status: "cancelled", duplicate: false });
  });

  test("registers the explicit checkpoint tool without removing the existing route hook", () => {
    const eventNames: string[] = [];
    const registeredTools: unknown[] = [];
    const pi = {
      on(name: string) {
        eventNames.push(name);
      },
      registerTool(tool: unknown) {
        registeredTools.push(tool);
      },
    } as unknown as ExtensionAPI;

    recommendAgentExtension(pi);

    expect(eventNames).toContain("tool_call");
    expect(
      registeredTools.filter(
        (tool) => isRecord(tool) && tool.name === SUBAGENT_CHECKPOINT_TOOL_NAME,
      ),
    ).toHaveLength(1);
    expect(
      registeredTools.filter((tool) => isRecord(tool) && tool.name === "recommend_agent"),
    ).toHaveLength(0);
  });
});
