import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  type AutocompleteProvider,
  type EditorTheme,
  getKeybindings,
  type TUI,
} from "@earendil-works/pi-tui";
import { PromptEditor, type PromptEditorState } from "../../prompt-ui/prompt-editor";
import { correctedPromptForInput } from "..";
import { parseTypoRules, typoRuleLengths } from "../typo-engine";

const rules = parseTypoRules(
  "teh the\nrepositry repository\nsucces{,ful,fully} success{,ful,fully}",
);
const typoRules = { rules, lengths: typoRuleLengths(rules) };

const identity = (text: string) => text;
const theme: EditorTheme = {
  borderColor: identity,
  selectList: {
    selectedPrefix: identity,
    selectedText: identity,
    description: identity,
    scrollInfo: identity,
    noMatch: identity,
  },
};
const tui = {
  requestRender() {},
} as unknown as TUI;
const state: PromptEditorState = {
  isWorking: () => false,
  getWorkingMarker: () => "●",
  getBranch: () => null,
  getProfileName: () => undefined,
  getStatuses: () => [],
};

function createEditor(): PromptEditor {
  return new PromptEditor(
    tui,
    theme,
    getKeybindings() as unknown as KeybindingsManager,
    {} as ExtensionAPI,
    { cwd: process.cwd() } as ExtensionContext,
    state,
    typoRules,
  );
}

describe("prompt typo correction", () => {
  test("allows ten visible autocomplete suggestions", () => {
    const editor = createEditor();

    expect(editor.getAutocompleteMaxVisible()).toBe(10);
  });

  test("corrects the completed word when a delimiter is typed", () => {
    for (const delimiter of [" ", ".", ",", "!", "?", ":", ";"]) {
      expect(correctedPromptForInput("fix teh", delimiter, typoRules)).toBe(`fix the${delimiter}`);
    }
  });

  test("preserves ordinary editor input handling when there is no correction", () => {
    expect(correctedPromptForInput("fix the", " ", typoRules)).toBeUndefined();
    expect(correctedPromptForInput("fix teh", "x", typoRules)).toBeUndefined();
  });

  test("uses expanded vim-abolish rules", () => {
    expect(correctedPromptForInput("succesfully", ".", typoRules)).toBe("successfully.");
  });

  test("preserves expanded paste content by delegating delimiter input", () => {
    const editor = createEditor();
    const pasted = "x".repeat(1001);

    editor.handleInput(`\u001b[200~${pasted}\u001b[201~`);
    for (const character of " teh") editor.handleInput(character);
    editor.handleInput(" ");

    expect(editor.getExpandedText()).toBe(`${pasted} teh `);
  });

  test("leaves typo-like autocomplete tokens to the native editor", async () => {
    const editor = createEditor();
    const provider: AutocompleteProvider = {
      triggerCharacters: ["@"],
      getSuggestions: async (lines, cursorLine, cursorCol) => ({
        items: [{ value: "repository", label: "repository" }],
        prefix: lines[cursorLine]?.slice(0, cursorCol) ?? "",
      }),
      applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
    };
    editor.setAutocompleteProvider(provider);
    expect(correctedPromptForInput("@repositry", ".", typoRules)).toBe("@repository.");

    for (const character of "@repositry") editor.handleInput(character);
    await Bun.sleep(30);
    expect(editor.isShowingAutocomplete()).toBeTrue();

    editor.handleInput(".");

    expect(editor.getText()).toBe("@repositry.");
    expect(editor.isShowingAutocomplete()).toBeTrue();
  });

  test("delegates autocomplete tokens while suggestions are still pending", () => {
    const editor = createEditor();
    const provider: AutocompleteProvider = {
      getSuggestions: async () => ({
        items: [{ value: "repository", label: "repository" }],
        prefix: "@repositry",
      }),
      applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
    };
    editor.setAutocompleteProvider(provider);

    for (const character of "@repositry") editor.handleInput(character);
    expect(editor.isShowingAutocomplete()).toBeFalse();

    editor.handleInput(".");

    expect(editor.getText()).toBe("@repositry.");
  });
});
