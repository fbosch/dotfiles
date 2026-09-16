import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const HERDR_BLOCKED_CHANNEL = "herdr:blocked";
const MAX_LABEL_LENGTH = 160;
const FALLBACK_LABEL = "Waiting for user input";

function labelPart(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  let printable = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    printable +=
      codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
        ? " "
        : character;
    if (printable.length >= MAX_LABEL_LENGTH) break;
  }

  const normalized = printable.replaceAll(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function promptLabel(title: unknown): string {
  const normalizedTitle = labelPart(title);
  if (normalizedTitle === undefined) return FALLBACK_LABEL;

  const label = `Waiting for user: ${normalizedTitle}`;
  return label.length <= MAX_LABEL_LENGTH ? label : `${label.slice(0, MAX_LABEL_LENGTH - 1)}…`;
}

export default function herdrPromptState(pi: ExtensionAPI): void {
  let promptActive = false;

  pi.on("ui_prompt_start", (event) => {
    if (promptActive) return;

    // Pi coalesces nested UI prompts into one outer span; mirror that span once in Herdr.
    promptActive = true;
    pi.events.emit(HERDR_BLOCKED_CHANNEL, {
      active: true,
      label: promptLabel(event.title),
    });
  });

  pi.on("ui_prompt_end", () => {
    if (!promptActive) return;

    promptActive = false;
    pi.events.emit(HERDR_BLOCKED_CHANNEL, { active: false });
  });
}
