import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { recallableTextArchiveRecords } from "./evidence-archive";
import { imageArchiveCandidates } from "./image-recall";

export function registerRecallActivation(
  pi: Pick<ExtensionAPI, "on" | "getActiveTools" | "setActiveTools" | "getAllTools">,
): void {
  const activate = (ctx: ExtensionContext) => {
    const active = pi.getActiveTools();
    if (active.includes("recall")) return;
    const branch = ctx.sessionManager.getBranch();
    if (
      recallableTextArchiveRecords(branch).length === 0 &&
      imageArchiveCandidates(branch, ctx.sessionManager.getSessionId()).length === 0
    )
      return;
    pi.setActiveTools([...active, "recall"]);
  };

  pi.on("session_start", (_event, ctx) => activate(ctx));
  pi.on("session_tree", (_event, ctx) => activate(ctx));
  pi.on("session_compact", (_event, ctx) => activate(ctx));
  // Boundary drafts are not committed until every handler finishes. Inspect the branch
  // before the next request, never activate from a mask proposal that might be rejected.
  pi.on("context", (_event, ctx) => activate(ctx));

  // setActiveTools changes the next turn snapshot, not the request already being
  // projected. Bridge that first request with an additive, request-local declaration.
  pi.on("context_with_system", (event) => {
    if (!pi.getActiveTools().includes("recall")) return;
    if (getCurrentTools(event.messages).some((tool) => tool.name === "recall")) return;
    const recall = pi.getAllTools().find((tool) => tool.name === "recall");
    if (!recall) return;
    const prompt = getCurrentSystemPrompt(event.messages);
    const guidance = (recall.promptGuidelines ?? []).filter((line) => !prompt.includes(line));
    return {
      messages: [
        ...event.messages,
        {
          role: "system" as const,
          content: guidance.join("\n"),
          toolsAdded: [
            { name: recall.name, description: recall.description, parameters: recall.parameters },
          ],
          timestamp: Date.now(),
        },
      ],
    };
  });
}
