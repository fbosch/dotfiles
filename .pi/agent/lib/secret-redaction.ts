import type { JsonValue } from "@earendil-works/pi-ai";

const REDACTED = "[REDACTED]";
const SECRET_FIELD_NAME =
  "(?:password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|access[_-]?key|(?:access|refresh|auth|bearer|session|id)[_-]?token|token|authorization|private[_-]?key|aws[_-]?(?:secret[_-]?access[_-]?key|access[_-]?key[_-]?id|session[_-]?token))";
const SECRET_FIELD = new RegExp(`^${SECRET_FIELD_NAME}$`, "i");
const SECRET_ASSIGNMENT = new RegExp(
  String.raw`(["']?\b${SECRET_FIELD_NAME}["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,;}"'\x60]+)`,
  "gi",
);

function redactText(text: string): string {
  return text
    .replace(
      /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z]+ )?PRIVATE KEY-----|$)/g,
      REDACTED,
    )
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{36,}|AIza[\w-]{30,}|(?:AKIA|ASIA)[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{16,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{40,})\b/g,
      REDACTED,
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED)
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/-]+=*/gi, `$1${REDACTED}`)
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+(?=@)/gi, `$1${REDACTED}`)
    .replace(SECRET_ASSIGNMENT, (_match, prefix: string) => `${prefix}${REDACTED}`);
}

/** Redact JSON string values without mutating callers or changing structural IDs and choice labels. */
export function redactSecretValues<T>(value: T): T {
  const visit = (item: unknown, field?: string): JsonValue => {
    if (typeof item === "string") {
      if (field && SECRET_FIELD.test(field) && item) return REDACTED;
      return redactText(item);
    }
    if (Array.isArray(item)) {
      const next = item.map((child) => visit(child, field));
      return next.every((child, index) => child === item[index]) ? item : next;
    }
    if (item && typeof item === "object") {
      const entries = Object.entries(item);
      const next = entries.map(([key, child]) => [key, visit(child, key)] as const);
      return next.every(([, child], index) => child === entries[index]?.[1])
        ? (item as Record<string, JsonValue>)
        : Object.fromEntries(next);
    }
    if (item === null || typeof item === "boolean" || typeof item === "number") return item;
    throw new Error("Secret redaction requires JSON data");
  };
  return visit(value) as T;
}
