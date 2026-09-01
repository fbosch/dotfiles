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
    expect(normaliseLanguage("javascriptreact")).toBe("javascript");
    expect(normaliseLanguage("jsdoc")).toBe("javascript");
    expect(normaliseLanguage("markdown_inline")).toBe("markdown");
    expect(normaliseLanguage("plaintext")).toBeUndefined();
    expect(normaliseLanguage("Elixir")).toBe("elixir");
  });

  test("infers languages from portable file paths", () => {
    expect(languageFromPath("src/example.TSX")).toBe("typescript");
    expect(languageFromPath("src/config.mts")).toBe("typescript");
    expect(languageFromPath("src/config.mjs")).toBe("javascript");
    expect(languageFromPath("C:\\project\\Dockerfile")).toBe("dockerfile");
    expect(languageFromPath("README")).toBeUndefined();
  });

  test("covers languages configured in Neovim", () => {
    const configuredLanguages = [
      ["astro", "src/page.astro", "Astro", ""],
      ["bash", "setup.sh", "Shell", ""],
      ["c", "main.c", "C", ""],
      ["css", "styles.css", "CSS", ""],
      ["dockerfile", "Dockerfile", "Dockerfile", "󰡨"],
      ["fish", "config.fish", "Fish", ""],
      ["html", "index.html", "HTML", ""],
      ["javascript", "index.js", "JavaScript", ""],
      ["json", "config.json", "JSON", ""],
      ["lua", "init.lua", "Lua", ""],
      ["markdown", "README.md", "Markdown", ""],
      ["mdx", "docs.mdx", "MDX", ""],
      ["nix", "flake.nix", "Nix", ""],
      ["rust", "main.rs", "Rust", ""],
      ["toml", "config.toml", "TOML", ""],
      ["typescript", "index.tsx", "TypeScript", ""],
      ["yaml", "config.yaml", "YAML", ""],
    ] as const;

    for (const [language, path, label, icon] of configuredLanguages) {
      expect(languageFromPath(path)).toBe(language);
      expect(LANGUAGE_LABELS[language]).toBe(label);
      expect(LANGUAGE_ICONS[language]).toBe(icon);
    }
  });

  test("exposes reusable aliases, extensions, labels, and icons", () => {
    expect(LANGUAGE_ALIASES.py).toBe("python");
    expect(EXTENSION_LANGUAGES.rs).toBe("rust");
    expect(LANGUAGE_LABELS.typescript).toBe("TypeScript");
    expect(LANGUAGE_ICONS.typescript).toBe("");
  });
});
