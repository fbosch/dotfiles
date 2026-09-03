import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";

export type QuickReplyIntent = "permission" | "continuation" | "approval" | "confirmation";

export interface QuickReply {
  label: string;
  message: string;
}

const MAX_QUESTION_LENGTH = 240;
const OPEN_QUESTION = /^(?:who|what|when|where|why|how|which)\b/i;
const ALTERNATIVE_CHOICE = /\b(?:either|or|versus|vs\.?)\b|\byes\s*\/\s*no\b/i;
const STRUCTURED_CHOICE = /^\s*(?:[-*+] |\d+[.)] )/;

const HIGH_RISK_ACTIONS = [
  /\bforce[- ]push(?:ing)?\b|\bgit\s+push\b[^?]{0,80}\s--force(?:-with-lease)?\b/i,
  /\bhard[- ]reset(?:ting)?\b|\bgit\s+reset\b[^?]{0,80}\s--hard\b/i,
  /\b(?:delete|deleting|remove|removing|erase|erasing|purge|purging|wipe|wiping|truncate|truncating|destroy|destroying|clear|clearing)\b[^?]{0,80}\b(?:production|remote)\b[^?]{0,80}\b(?:data|records?|files?|databases?|tables?|buckets?|branch(?:es)?)\b/i,
  /\b(?:production|remote)\b[^?]{0,80}\b(?:data|records?|files?|databases?|tables?|buckets?|branch(?:es)?)\b[^?]{0,80}\b(?:delete|deleting|remove|removing|erase|erasing|purge|purging|wipe|wiping|truncate|truncating|destroy|destroying|clear|clearing)\b/i,
  /\b(?:delete|deleting|remove|removing|drop|dropping|truncate|truncating|wipe|wiping|destroy|destroying)\b[^?]{0,40}\b(?:database|schema|table)\b/i,
  /\b(?:delete|deleting|erase|erasing|purge|purging|wipe|wiping|destroy|destroying)\b[^?]{0,40}\b(?:all\s+)?(?:data|records?|backups?)\b/i,
  /\bdeploy(?:ing)?\b[^?]{0,80}\b(?:directly\s+)?to\s+(?:the\s+)?(?:production|prod)\b/i,
  /\bpublish(?:ing)?\b/i,
  /\b(?:send|sending|email|emailing)\b[^?]{0,80}\b(?:email|message|announcement|notification|communication|post)\b/i,
  /\b(?:rotate|rotating|revoke|revoking|expose|exposing|replace|replacing|share|sharing|show|showing|display|displaying|print|printing|log|logging|leak|leaking|send|sending)\b[^?]{0,80}\b(?:credentials?|secrets?|api[- ]?keys?|access[- ]?tokens?|passwords?)\b/i,
  /\b(?:credentials?|secrets?|api[- ]?keys?|access[- ]?tokens?|passwords?)\b[^?]{0,80}\b(?:rotate|rotating|revoke|revoking|expose|exposing|replace|replacing|share|sharing|show|showing|display|displaying|print|printing|log|logging|leak|leaking|send|sending)\b/i,
  /\b(?:irreversibly|permanently)\s+overwrite\b|\boverwrite\b[^?]{0,40}\b(?:irreversibly|permanently)\b/i,
] as const;

const FIXED_REPLIES: Record<QuickReplyIntent, readonly QuickReply[]> = {
  permission: [
    { label: "Go ahead", message: "Go ahead" },
    { label: "Not now", message: "Not now" },
    { label: "Explain first", message: "Explain first" },
  ],
  continuation: [
    { label: "Continue", message: "Continue" },
    { label: "Stop here", message: "Stop here" },
  ],
  approval: [
    { label: "Looks good", message: "Looks good" },
    { label: "Needs changes", message: "Needs changes" },
  ],
  confirmation: [
    { label: "Yes", message: "Yes" },
    { label: "No", message: "No" },
  ],
};

export function extractVisibleAssistantProse(message: Pick<AssistantMessage, "content">): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function extractFinalRelevantQuestion(prose: string): string | undefined {
  const visibleLines = removeFencedCodeAndQuotes(prose);
  const paragraphs = visibleLines
    .join("\n")
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  const finalParagraph = paragraphs.at(-1);

  if (finalParagraph === undefined) return undefined;
  if (finalParagraph.split("\n").some((line) => STRUCTURED_CHOICE.test(line))) return undefined;

  const normalizedParagraph = normalizeInlineMarkdown(finalParagraph);
  if (HIGH_RISK_ACTIONS.some((pattern) => pattern.test(normalizedParagraph))) return undefined;
  if (normalizedParagraph.endsWith("?") === false) return undefined;
  if ((normalizedParagraph.match(/\?/g) ?? []).length !== 1) return undefined;

  const questionStart = Math.max(
    normalizedParagraph.lastIndexOf(". "),
    normalizedParagraph.lastIndexOf("! "),
  );
  const question = normalizedParagraph.slice(questionStart < 0 ? 0 : questionStart + 2).trim();

  if (question.length === 0 || question.length > MAX_QUESTION_LENGTH) return undefined;
  return question;
}

export function classifyQuickReplyIntent(question: string): QuickReplyIntent | undefined {
  if (OPEN_QUESTION.test(question)) return undefined;
  if (ALTERNATIVE_CHOICE.test(question)) return undefined;
  if (HIGH_RISK_ACTIONS.some((pattern) => pattern.test(question))) return undefined;

  if (/^(?:continue|proceed)\?$/i.test(question)) return "continuation";
  if (/^ready for me to (?:continue|proceed)\?$/i.test(question)) return "continuation";

  const permission = question.match(
    /^(?:should i|shall i|would you like me to|do you want me to|want me to|may i)\s+(.+)\?$/i,
  );
  if (permission !== null) {
    const action = permission[1]?.trim();
    if (action === undefined || action.length === 0) return undefined;
    return /^(?:continue|proceed)\b/i.test(action) ? "continuation" : "permission";
  }

  if (
    /^does (?:this|that)(?: [a-z0-9'-]+){0,4} (?:look right|sound good|seem correct)\?$/i.test(
      question,
    ) ||
    /^does the (?:approach|plan|change|implementation|configuration) (?:look right|sound good|seem correct)\?$/i.test(
      question,
    )
  ) {
    return "approval";
  }

  if (
    /^is (?:this|that) (?:correct|acceptable)\?$/i.test(question) ||
    /^is (?:this|that) what you intended\?$/i.test(question)
  ) {
    return "confirmation";
  }

  return undefined;
}

export function produceFixedReplies(intent: QuickReplyIntent): QuickReply[] {
  return FIXED_REPLIES[intent].map((reply) => ({ ...reply }));
}

export function detectQuickReplies(prose: string): QuickReply[] {
  const question = extractFinalRelevantQuestion(prose);
  if (question === undefined) return [];

  const intent = classifyQuickReplyIntent(question);
  return intent === undefined ? [] : produceFixedReplies(intent);
}

function removeFencedCodeAndQuotes(prose: string): string[] {
  const visibleLines: string[] = [];
  let fenceCharacter: "`" | "~" | undefined;
  let fenceLength = 0;

  for (const line of prose.replace(/\r\n?/g, "\n").split("\n")) {
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceCharacter !== undefined) {
      const marker = fence?.[1];
      if (marker?.startsWith(fenceCharacter) === true && marker.length >= fenceLength) {
        fenceCharacter = undefined;
        fenceLength = 0;
      }
      continue;
    }

    const marker = fence?.[1];
    if (marker !== undefined) {
      fenceCharacter = marker[0] as "`" | "~";
      fenceLength = marker.length;
      continue;
    }
    if (/^\s*>/.test(line)) continue;

    visibleLines.push(line);
  }

  return visibleLines;
}

function normalizeInlineMarkdown(paragraph: string): string {
  return paragraph
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
