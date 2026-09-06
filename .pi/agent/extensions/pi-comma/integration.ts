import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PREFIX_REQUEST_EVENT = "pi-comma:bash-prefix-request";

interface PrefixRequest {
  prefix?: string;
}

function isPrefixRequest(value: unknown): value is PrefixRequest {
  return typeof value === "object" && value !== null;
}

export function providePiCommaBashPrefix(pi: ExtensionAPI, prefix: string): () => void {
  return pi.events.on(PREFIX_REQUEST_EVENT, (value: unknown) => {
    if (isPrefixRequest(value) && value.prefix === undefined) value.prefix = prefix;
  });
}

export function requestPiCommaBashPrefix(pi: ExtensionAPI): string | undefined {
  const request: PrefixRequest = {};
  pi.events.emit(PREFIX_REQUEST_EVENT, request);
  return request.prefix;
}

export function appendCommandPrefix(
  current: string | undefined,
  addition: string | undefined,
): string | undefined {
  if (current === undefined) return addition;
  if (addition === undefined) return current;
  return `${current}\n${addition}`;
}
