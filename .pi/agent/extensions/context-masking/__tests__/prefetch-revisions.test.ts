import { afterEach, expect, test } from "bun:test";
import type { ClassifierContext } from "@earendil-works/pi-ai";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { recallSession } from "../../../benchmarks/context-recall-offline";
import { userStartEvent } from "../../shared/__tests__/agent-start-events";
import { RECALL_LIMITS, recallSaved, recallUnified, registerRecallPrefetch } from "../recall";

const sessions: Awaited<ReturnType<typeof recallSession>>[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.cleanup();
});

test("prefetch classification retains the revision header outside the matching window", async () => {
  const texts = [
    "Revision 1.\nUnrelated first record.\nUnrelated second record.\nUnrelated third record.\nService ledger approved expiry_date: 2035-08-04.\nEnd of snapshot.",
    "Revision 2 supersedes revision 1.\nUnrelated first record.\nUnrelated second record.\nUnrelated third record.\nService ledger approved expiry_date: 2032-10-29.\nEnd of snapshot.",
  ];
  const session = await recallSession(texts.map((text) => ({ tool: "read", args: {}, text })));
  sessions.push(session);
  type Handler = (
    event: BeforeAgentStartEvent,
    ctx: ExtensionContext,
  ) => Promise<BeforeAgentStartEventResult | undefined>;
  let handler: Handler | undefined;
  const packets: ClassifierContext[] = [];
  // SAFETY: this registration uses only on(before_agent_start), with the handler type above.
  registerRecallPrefetch(
    {
      on: (_name: string, fn: Handler) => {
        handler = fn;
      },
    } as unknown as Pick<ExtensionAPI, "on">,
    () => session.root,
    () => true,
    {
      classifier: async (input) => {
        packets.push(input);
        return { ok: false, reason: "disabled", stage: "config" };
      },
    },
  );
  if (!handler) throw new Error("Missing prefetch handler");
  // SAFETY: injected callbacks use no other context properties.
  await handler(userStartEvent("What is the latest approved expiry_date for service ledger?"), {
    sessionManager: session.manager,
  } as unknown as ExtensionContext);
  expect(packets).toHaveLength(1);
  const candidates = packets[0]?.state.text_candidates;
  if (!Array.isArray(candidates)) throw new Error("Missing candidate packet");
  expect(candidates).toHaveLength(2);
  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null || !("excerpt" in candidate))
      throw new Error("Malformed candidate");
    const current = String(candidate.excerpt).includes("2032-10-29");
    expect(candidate.source_context).toContain(
      current ? "1│Revision 2 supersedes revision 1." : "1│Revision 1.",
    );
  }
  const manual = await recallSaved(
    session.manager.getBranch(),
    session.root,
    "latest approved expiry_date for service ledger",
    1,
  );
  expect(manual.text).toContain(
    "Source context (same archive):\n1│Revision 2 supersedes revision 1.",
  );
  const unified = await recallUnified(
    session.manager.getBranch(),
    session.root,
    session.manager.getSessionId(),
    ["latest approved expiry_date for service ledger"],
    1,
  );
  expect(
    unified.content.some(
      (block) =>
        block.type === "text" && block.text.includes("1│Revision 2 supersedes revision 1."),
    ),
  ).toBe(true);
});

test("source context is bounded and excludes recall framing from the prefix", async () => {
  const text =
    "Query: What is the approved expiry_date?\nSaved path: /untrusted/frame\n" +
    "Revision 2 supersedes revision 1. æøå " +
    "x".repeat(2_000) +
    "\nUnrelated record.\nService ledger approved expiry_date: 2032-10-29.";
  const session = await recallSession([{ tool: "read", args: {}, text }]);
  sessions.push(session);
  const report = await recallSaved(
    session.manager.getBranch(),
    session.root,
    "service ledger expiry_date",
    1,
  );
  const context = report.passages[0]?.sourceContext;
  expect(context).toContain("Revision 2 supersedes revision 1. æøå");
  expect(context?.length).toBeLessThanOrEqual(RECALL_LIMITS.sourceContextChars);
  expect(context).not.toContain("/untrusted/frame");
  expect(report.text).toContain("Service ledger approved expiry_date: 2032-10-29.");
  expect(report.text.length).toBeLessThanOrEqual(RECALL_LIMITS.outputChars);
});
