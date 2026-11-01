import { createHash } from "node:crypto";
import { inspectProviderRequest } from "../codemode/request";

export const MOCK_TOOLS = [
  "read",
  "write",
  "alternate_write",
  "request",
  "ask_user",
  "resolve_path",
] as const;
export interface DeliveryCheck {
  valid: boolean;
  issues: string[];
  sectionHash: string;
  tools: string[];
}

export function checkDelivery(payload: unknown, expected: string): DeliveryCheck {
  const request = inspectProviderRequest(payload);
  const sections = [
    ...request.instructions.matchAll(/<sandbox_context>\n([\s\S]*?)\n<\/sandbox_context>/gu),
  ].map((m) => m[1]);
  const issues: string[] = [];
  if (expected ? sections.length !== 1 || sections[0] !== expected : sections.length !== 0)
    issues.push("sandbox guidance missing, duplicated, or changed");
  const tools = [...new Set(request.tools.map((t) => t.name))].sort();
  if (JSON.stringify(tools) !== JSON.stringify([...MOCK_TOOLS].sort()))
    issues.push("provider declarations differ from mock-tool allowlist");
  return {
    valid: issues.length === 0,
    issues,
    sectionHash: createHash("sha256").update(sections.join("\n")).digest("hex"),
    tools,
  };
}

export function deliveryVerified(value: unknown, guidance: unknown): boolean {
  if (!Array.isArray(value) || !value.length || typeof guidance !== "string") return false;
  const hash = createHash("sha256").update(guidance).digest("hex");
  const tools = JSON.stringify([...MOCK_TOOLS].sort());
  return value.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const check = entry as Record<string, unknown>;
    return (
      check.valid === true &&
      Array.isArray(check.issues) &&
      check.issues.length === 0 &&
      check.sectionHash === hash &&
      Array.isArray(check.tools) &&
      check.tools.every((t) => typeof t === "string") &&
      JSON.stringify([...check.tools].sort()) === tools
    );
  });
}
