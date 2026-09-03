import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";

export type QuickReplyIntent = "permission" | "continuation" | "approval" | "confirmation";

export interface QuickReply {
  label: string;
  message: string;
}

const MAX_PROSE_LENGTH = 32_000;
const MAX_QUESTION_LENGTH = 240;
const MIN_INTENT_SCORE = 5;
const MIN_SCORE_MARGIN = 2;
const CONTEXT_WORD_SEGMENTER = new Intl.Segmenter("en", { granularity: "word" });
const OPEN_QUESTION = /^(?:who|what|when|where|why|how|which)\b/i;
const ALTERNATIVE_CHOICE =
  /\b(?:either|or|versus|vs\.?|choose|which)\b|\b(?:yes|no)\s*\/\s*(?:yes|no)\b/i;
const STRUCTURED_CHOICE = /^\s*(?:[-*+] |\d+[.)] |\|)/;
const STRUCTURED_CHOICE_HEADING =
  /^(?:(?:here (?:are|is) (?:the )?)?(?:available )?(?:alternatives?|choices?|options?)|choose|select)(?:\s+one)?\s*:/i;
const NEGATIVE_QUESTION =
  /\b(?:cannot|never|no one|nobody|none|nothing|not)\b|\b(?:ain|aren|can|couldn|didn|doesn|don|hasn|haven|isn|mustn|shouldn|wasn|weren|won|wouldn)['’]t\b/i;
const VAGUE_QUESTION = /\b(?:anything|everything|something|whatever)\b/i;
const CONDITIONAL_QUESTION =
  /\b(?:unless|assuming|supposing)\b|\bif\b(?![-\s]+(?:branch|clause|condition|expression|statement)\b)/i;
const RHETORICAL_QUESTION =
  /\b(?:obviously|seriously)\b|\b(?:can|could|would)n['’]t you\b|\bwhy would\b|^(?:(?:do|would)\s+you|(?:can|could|may|shall|should)\s+i)\s+really\b/i;

const PERMISSION_QUESTION =
  /^(?:(?:should|shall|may|can|could)\s+i|(?:should|shall)\s+we|(?:would\s+you\s+like|do\s+you\s+(?:want|need)|would\s+you\s+prefer)\s+me\s+to|(?:want|need)\s+me\s+to|(?:is|would)\s+it\s+(?:be\s+)?(?:okay|all right)\s+for\s+me\s+to)\s+(.+)\?$/i;
const AMBIGUOUS_ACTION_HEAD =
  /^(?:be|choose|decide|do|go ahead|guess|prefer|recommend|think|use|wonder)\b/i;
const SELF_CONTAINED_ACTION =
  /^(?:commit|continue|explain|proceed|rerun|resume|retry|review|test|verify)$/i;
const VAGUE_ACTION =
  /^(?:[a-z][\w-]*(?:\s+(?:about|on|with))?\s+(?:anything|everything|it|that|this|them|those)(?:\s+(?:first|instead|next|now|quickly))?|(?:complete|do|finish|handle)\s+(?:the\s+)?(?:anything|everything|rest|task|work)|take care of\s+(?:it|that|this|the rest))$/i;
const CONTINUATION_ACTION =
  /^(?:continue|proceed|move on|move to (?:the )?next step|go on|resume|start (?:the )?next step|take (?:the )?next step)\b/i;
const DIRECT_CONTINUATION_QUESTION =
  /^(?:(?:continue|proceed|move on|move to (?:the )?next step|go on|resume)(?:\s+(?:with|to)\s+(?:the\s+)?(?:next\s+)?step)?|(?:ready|okay)\s+(?:(?:for me|for us)\s+)?to\s+(?:continue|proceed|move on)|(?:are you ready|do you want|would you like)\s+to\s+(?:continue|proceed|move on)|(?:shall|should)\s+we\s+(?:(?:continue|proceed|move on)(?:\s+to\s+(?:the\s+)?next step)?|move to (?:the )?next step))\?$/i;

const REVIEWABLE_SUBJECT =
  "(?:(?:this|that)(?: (?:approach|plan|change|implementation|configuration|solution|result|output|design|wording|summary|explanation))?|(?:these|those) (?:changes|results|outputs)|the (?:approach|plan|change|implementation|configuration|solution|result|output|design|wording|summary|explanation))";
const NAMED_REVIEWABLE_SUBJECT =
  "(?:(?:this|that|the) (?:approach|plan|change|implementation|configuration|solution|result|output|design|wording|summary|explanation)|(?:these|those) (?:changes|results|outputs))";
const EVALUATION_PREDICATE =
  "(?:look (?:right|good|correct|reasonable|acceptable)|sound (?:good|right|reasonable|acceptable)|seem (?:correct|reasonable|acceptable)|work for you|make sense|match (?:your intent|your expectations|what you (?:asked for|intended|meant|expected))|meet your (?:expectations|requirements))";
const APPROVAL_QUESTION = new RegExp(
  `^(?:does|do) ${REVIEWABLE_SUBJECT} ${EVALUATION_PREDICATE}\\?$`,
  "i",
);
const DIRECT_APPROVAL_QUESTION = new RegExp(
  `^(?:is|are) ${NAMED_REVIEWABLE_SUBJECT} (?:acceptable|good|reasonable|right)\\?$`,
  "i",
);
const SHORT_APPROVAL_QUESTION = /^(?:looks? right|sounds? good|seems? reasonable)\?$/i;
const EVALUATIVE_STATEMENT =
  /\b(?:look|looks|sound|sounds|seem|seems)\s+(?:right|good|correct|reasonable|acceptable)\b|\b(?:work|works)\s+for\s+you\b/i;
const CONFIRMATION_QUESTION =
  /^(?:is (?:this|that) (?:correct|acceptable|what you (?:intended|meant|expected|asked for))|is (?:this|that|the) (?:approach|plan|change|implementation|configuration|solution|result|output|design|wording|summary|explanation) correct|is my understanding (?:correct|right)|did i (?:understand|capture|get) (?:this|that|your request) (?:right|correctly)|have i (?:got|understood|captured) (?:this|that|your request) (?:right|correctly))\?$/i;
const CONFIRMATION_TAG = /^(.+),\s*(?:right|correct)\?$/i;

const HIGH_RISK_ACTIONS = [
  /\b(?:cannot|can['’]t)\s+be\s+(?:reversed|undone)\b|\birreversib(?:le|ly)\b|\bpermanently\b/i,
  /\b(?:delet(?:e|ed|ing|ion)|eras(?:e|ed|ing)|purg(?:e|ed|ing)|wip(?:e|ed|ing)|truncat(?:e|ed|ing|ion)|destroy(?:ed|ing)?|destruction|drop(?:ped|ping)?|overwrit(?:e|ten|ing)|overwrote)\b/i,
  /\b(?:access|connect|inspect|query|read)\b(?=[^?]{0,100}\b(?:production|prod|live)\b)(?=[^?]{0,100}\b(?:data|database|logs?|service|system)\b)/i,
  /\brm\b/i,
  /\bforce[- ]push(?:ing)?\b|\bgit\s+push\b|\bpush(?:ing)?\b[^?]{0,50}\b(?:branch|changes?|commits?|origin|remote|upstream)\b/i,
  /\bhard[- ]reset(?:ting)?\b|\bgit\s+reset\b[^?]{0,80}\s--hard\b/i,
  /\bgit\s+(?:clean|restore)\b|\bgit\s+checkout\b[^?]{0,40}\s--|\bgit\s+branch\b[^?]{0,40}\s-[dD]\b/i,
  /\b(?:discard|discarding|revert|reverting)\b[^?]{0,60}\b(?:changes?|work|files?)\b/i,
  /\b(?:remove|removing|clear|clearing)\b[^?]{0,80}\b(?:production|remote)\b[^?]{0,80}\b(?:data|records?|files?|databases?|tables?|buckets?|branch(?:es)?)\b/i,
  /\b(?:production|remote)\b[^?]{0,80}\b(?:data|records?|files?|databases?|tables?|buckets?|branch(?:es)?)\b[^?]{0,80}\b(?:remove|removing|clear|clearing)\b/i,
  /\b(?:deploy|deploying|send|sending|email|emailing|post|posting|upload|uploading)\b/i,
  /\bpublish(?:ing)?\b|\breleas(?:e|ing)\b[^?]{0,50}\b(?:artifact|build|package|version)\b/i,
  /\b(?:install|uninstall|upgrade)\b[^?]{0,60}\b(?:dependency|extension|package|plugin|software|tool)\b/i,
  /\b(?:approve|close|merge)\b[^?]{0,50}\b(?:merge request|pr|pull request)\b|\bmerge\b[^?]{0,40}\b(?:branch|changes?|commits?)\b/i,
  /\b(?:complete|submit|approve|make|place|process)\b[^?]{0,50}\b(?:order|payment|purchase|transaction)\b|\btransfer\b[^?]{0,40}\b(?:funds?|money)\b/i,
  /\b(?:change|elevate|grant|modify|revoke)\b[^?]{0,50}\b(?:access|permissions?|privileges?|roles?)\b/i,
  /\b(?:execute|run)\b[^?]{0,50}\b(?:binary|executable|installer|script)\b/i,
  /\b(?:rotate|rotating|revoke|revoking|expose|exposing|replace|replacing|share|sharing|show|showing|display|displaying|print|printing|log|logging|leak|leaking|send|sending)\b[^?]{0,80}\b(?:credentials?|secrets?|api[- ]?keys?|access[- ]?tokens?|passwords?)\b/i,
  /\b(?:credentials?|secrets?|api[- ]?keys?|access[- ]?tokens?|passwords?)\b[^?]{0,80}\b(?:rotate|rotating|revoke|revoking|expose|exposing|replace|replacing|share|sharing|show|showing|display|displaying|print|printing|log|logging|leak|leaking|send|sending)\b/i,
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
  if (prose.length > MAX_PROSE_LENGTH) return undefined;

  const visibleLines = removeFencedCodeAndQuotes(prose);
  const paragraphs = visibleLines
    .join("\n")
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  const finalParagraph = paragraphs.at(-1);

  if (finalParagraph === undefined) return undefined;
  if (finalParagraph.split("\n").some((line) => STRUCTURED_CHOICE.test(line))) return undefined;

  const previousParagraph = paragraphs.at(-2);
  if (previousParagraph !== undefined && hasStructuredChoices(previousParagraph)) return undefined;

  const normalizedParagraph = normalizeInlineMarkdown(finalParagraph);
  if (HIGH_RISK_ACTIONS.some((pattern) => pattern.test(normalizedParagraph))) return undefined;
  if (ALTERNATIVE_CHOICE.test(normalizedParagraph)) return undefined;
  if (normalizedParagraph.endsWith("?") === false) return undefined;
  if (countSyntacticQuestionMarks(normalizedParagraph) !== 1) return undefined;

  const questionStart = Math.max(
    normalizedParagraph.lastIndexOf(". "),
    normalizedParagraph.lastIndexOf("! "),
    normalizedParagraph.lastIndexOf("; "),
    normalizedParagraph.lastIndexOf(": "),
  );
  const question = normalizedParagraph.slice(questionStart < 0 ? 0 : questionStart + 2).trim();

  if (question.length === 0 || question.length > MAX_QUESTION_LENGTH) return undefined;
  if (previousParagraph !== undefined && hasRejectedContext(previousParagraph, question)) {
    return undefined;
  }

  return question;
}

export function classifyQuickReplyIntent(question: string): QuickReplyIntent | undefined {
  const normalizedQuestion = question.replace(/\s+/g, " ").trim();
  if (isRejectedQuestion(normalizedQuestion)) return undefined;

  const scores = createIntentScores();
  if (DIRECT_CONTINUATION_QUESTION.test(normalizedQuestion)) {
    addIntentScore(scores, "continuation", 6);
  }

  const permission = normalizedQuestion.match(PERMISSION_QUESTION);
  const action = permission?.[1]?.trim();
  if (action !== undefined && action.length > 0 && VAGUE_ACTION.test(action) === false) {
    addIntentScore(scores, "permission", 3);
    if (CONTINUATION_ACTION.test(action)) {
      addIntentScore(scores, "continuation", 6);
    } else if (hasSpecificAction(action)) {
      addIntentScore(scores, "permission", 2);
    }
  }

  if (
    APPROVAL_QUESTION.test(normalizedQuestion) ||
    DIRECT_APPROVAL_QUESTION.test(normalizedQuestion) ||
    SHORT_APPROVAL_QUESTION.test(normalizedQuestion)
  ) {
    addIntentScore(scores, "approval", 6);
  }

  if (CONFIRMATION_QUESTION.test(normalizedQuestion)) {
    addIntentScore(scores, "confirmation", 6);
  }

  const tag = normalizedQuestion.match(CONFIRMATION_TAG);
  const statement = tag?.[1]?.trim();
  if (statement !== undefined && statement.length > 0) {
    addIntentScore(scores, EVALUATIVE_STATEMENT.test(statement) ? "approval" : "confirmation", 6);
  }

  return resolveIntent(scores);
}

function hasSpecificAction(action: string): boolean {
  const normalizedAction = action.replace(/^please\s+/i, "").trim();
  if (
    normalizedAction.length === 0 ||
    AMBIGUOUS_ACTION_HEAD.test(normalizedAction) ||
    VAGUE_ACTION.test(normalizedAction)
  ) {
    return false;
  }

  if (SELF_CONTAINED_ACTION.test(normalizedAction)) return true;

  // Permission grammar already establishes an infinitive action. Requiring a complement avoids
  // vague one-word prompts without coupling recall to an ever-growing positive verb list.
  return (normalizedAction.match(/[a-z0-9][\w'-]*/gi) ?? []).length >= 2;
}

function createIntentScores(): Record<QuickReplyIntent, number> {
  return {
    permission: 0,
    continuation: 0,
    approval: 0,
    confirmation: 0,
  };
}

function addIntentScore(
  scores: Record<QuickReplyIntent, number>,
  intent: QuickReplyIntent,
  points: number,
): void {
  scores[intent] += points;
}

function resolveIntent(scores: Record<QuickReplyIntent, number>): QuickReplyIntent | undefined {
  const ranked = (Object.entries(scores) as Array<[QuickReplyIntent, number]>).sort(
    ([, leftScore], [, rightScore]) => rightScore - leftScore,
  );
  const top = ranked[0];
  const runnerUp = ranked[1];

  if (
    top === undefined ||
    top[1] < MIN_INTENT_SCORE ||
    runnerUp === undefined ||
    top[1] - runnerUp[1] < MIN_SCORE_MARGIN
  ) {
    return undefined;
  }

  return top[0];
}

function isRejectedQuestion(question: string): boolean {
  return (
    question.length === 0 ||
    question.length > MAX_QUESTION_LENGTH ||
    question.endsWith("?") === false ||
    countSyntacticQuestionMarks(question) !== 1 ||
    OPEN_QUESTION.test(question) ||
    ALTERNATIVE_CHOICE.test(question) ||
    NEGATIVE_QUESTION.test(question) ||
    VAGUE_QUESTION.test(question) ||
    CONDITIONAL_QUESTION.test(question) ||
    RHETORICAL_QUESTION.test(question) ||
    HIGH_RISK_ACTIONS.some((pattern) => pattern.test(question))
  );
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

function hasRejectedContext(paragraph: string, question: string): boolean {
  const normalizedContext = normalizeInlineMarkdown(paragraph);
  if (HIGH_RISK_ACTIONS.some((pattern) => pattern.test(normalizedContext))) return true;

  const hasRejectedCue =
    NEGATIVE_QUESTION.test(normalizedContext) ||
    CONDITIONAL_QUESTION.test(normalizedContext) ||
    ALTERNATIVE_CHOICE.test(normalizedContext);
  if (hasRejectedCue === false) return false;

  if (isContinuationQuestion(question)) return true;

  const contextKeywords = extractContextKeywords(normalizedContext);
  return [...extractContextKeywords(question)].some((keyword) => contextKeywords.has(keyword));
}

function isContinuationQuestion(question: string): boolean {
  if (DIRECT_CONTINUATION_QUESTION.test(question)) return true;
  const action = question.match(PERMISSION_QUESTION)?.[1]?.trim();
  return action !== undefined && CONTINUATION_ACTION.test(action);
}

function extractContextKeywords(text: string): Set<string> {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "are",
    "be",
    "can",
    "could",
    "did",
    "do",
    "does",
    "for",
    "from",
    "i",
    "is",
    "it",
    "may",
    "me",
    "must",
    "not",
    "of",
    "on",
    "or",
    "shall",
    "should",
    "that",
    "the",
    "this",
    "to",
    "we",
    "will",
    "with",
    "would",
    "you",
    "your",
  ]);
  const words: string[] = [];
  for (const part of CONTEXT_WORD_SEGMENTER.segment(text)) {
    if (part.isWordLike) words.push(part.segment.toLocaleLowerCase("en"));
  }

  return new Set(words.map(normalizeContextKeyword).filter((word) => !stopWords.has(word)));
}

function normalizeContextKeyword(word: string): string {
  if (word.endsWith("ied") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);
  if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && word.length > 3) return word.slice(0, -1);
  return word;
}

function countSyntacticQuestionMarks(text: string): number {
  let delimiter: "'" | '"' | "`" | undefined;
  let count = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (delimiter !== undefined) {
      if (character === "\\") {
        index += 1;
      } else if (character === delimiter) {
        delimiter = undefined;
      }
      continue;
    }

    if (
      character === "`" ||
      character === '"' ||
      (character === "'" && isWordApostrophe(text, index) === false)
    ) {
      delimiter = character;
    } else if (character === "?") {
      count += 1;
    }
  }

  return count;
}

function isWordApostrophe(text: string, index: number): boolean {
  return /[a-z0-9]/i.test(text[index - 1] ?? "") && /[a-z0-9]/i.test(text[index + 1] ?? "");
}

function hasStructuredChoices(paragraph: string): boolean {
  const lines = paragraph.split("\n");
  const structuredLineCount = lines.filter((line) => STRUCTURED_CHOICE.test(line)).length;

  // Two adjacent list/table rows are choice-like enough to fail closed even without a heading.
  return (
    structuredLineCount >= 2 ||
    (structuredLineCount === 1 &&
      STRUCTURED_CHOICE_HEADING.test(normalizeInlineMarkdown(paragraph)))
  );
}

function normalizeInlineMarkdown(paragraph: string): string {
  return paragraph
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
