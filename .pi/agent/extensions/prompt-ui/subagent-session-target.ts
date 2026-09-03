export const SUBAGENT_SESSION_URL_PREFIX = "pi-action://subagents/session";

export interface SubagentSessionTarget {
  agentId: string;
  displayName: string;
  description: string;
}

export function subagentSessionUrl(target: SubagentSessionTarget): string {
  const url = new URL(SUBAGENT_SESSION_URL_PREFIX);
  url.searchParams.set("id", target.agentId);
  url.searchParams.set("name", target.displayName);
  url.searchParams.set("description", target.description);
  return url.toString();
}

export function parseSubagentSessionUrl(url: string): SubagentSessionTarget | undefined {
  try {
    const query = url.split("?", 2)[1]?.split("#", 1)[0] ?? "";
    if (/%(?![\dA-Fa-f]{2})/.test(query)) return undefined;

    const parsed = new URL(url);
    if (
      parsed.protocol !== "pi-action:" ||
      parsed.hostname !== "subagents" ||
      parsed.pathname !== "/session" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.port !== "" ||
      parsed.hash !== ""
    ) {
      return undefined;
    }

    const parameters = [...parsed.searchParams.keys()];
    if (
      parameters.length !== 3 ||
      parsed.searchParams.getAll("id").length !== 1 ||
      parsed.searchParams.getAll("name").length !== 1 ||
      parsed.searchParams.getAll("description").length !== 1
    ) {
      return undefined;
    }

    const agentId = parsed.searchParams.get("id");
    const displayName = parsed.searchParams.get("name");
    const description = parsed.searchParams.get("description");
    if (agentId === null || agentId.length === 0 || displayName === null || description === null) {
      return undefined;
    }
    return { agentId, displayName, description };
  } catch {
    return undefined;
  }
}
