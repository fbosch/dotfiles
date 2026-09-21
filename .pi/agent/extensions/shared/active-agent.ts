const ACTIVE_AGENT_MARKER = /^<active_agent\s+name=(?:"([^"\r\n]+)"|'([^'\r\n]+)')[^>]*\/>\s*$/u;

export function activeAgentName(systemPrompt: string | undefined): string | undefined {
  if (systemPrompt === undefined) return undefined;

  for (const line of systemPrompt.split("\n")) {
    const match = ACTIVE_AGENT_MARKER.exec(line);
    if (match !== null) return match[1] ?? match[2];
  }
  return undefined;
}
