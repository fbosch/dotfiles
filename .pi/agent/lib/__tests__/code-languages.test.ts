import { describe, expect, test } from "bun:test";
import {
  EXTENSION_LANGUAGES,
  LANGUAGE_ALIASES,
  LANGUAGE_ICONS,
  LANGUAGE_LABELS,
  languageFromPath,
  normaliseLanguage,
} from "../code-languages";

describe("code language metadata", () => {
  test("normalises aliases and preserves unknown languages", () => {
    expect(normaliseLanguage(" TS ")).toBe("typescript");
    expect(normaliseLanguage("plaintext")).toBeUndefined();
    expect(normaliseLanguage("Elixir")).toBe("elixir");
  });

  test("infers languages from portable file paths", () => {
    expect(languageFromPath("src/example.TSX")).toBe("typescript");
    expect(languageFromPath("C:\\project\\Dockerfile")).toBe("dockerfile");
    expect(languageFromPath("README")).toBeUndefined();
  });

  test("exposes reusable aliases, extensions, labels, and icons", () => {
    expect(LANGUAGE_ALIASES.py).toBe("python");
    expect(EXTENSION_LANGUAGES.rs).toBe("rust");
    expect(LANGUAGE_LABELS.typescript).toBe("TypeScript");
    expect(LANGUAGE_ICONS.typescript).toBe("");
  });
});
