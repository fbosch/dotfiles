import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { AgentMentionCache } from "../../mentions/agent-mentions";
import { PromptEditor, type PromptEditorState } from "../../prompt-ui/prompt-editor";
import { correctedPromptForInput } from "..";
import { parseTypoRules, typoRuleLengths } from "../typo-engine";

const TYPO_EXTENSION_PATH = new URL("../index.ts", import.meta.url).pathname;

type ProbeResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

async function runProbe(script: string, configHome: string): Promise<ProbeResult> {
  const child = Bun.spawn([process.execPath, "--no-install", "-e", script, TYPO_EXTENSION_PATH], {
    env: { ...process.env, XDG_CONFIG_HOME: configHome },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr, stdout };
}
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
    new AgentMentionCache(process.cwd(), process.cwd(), false),
  );
}

test("defers typo rule loading until a UI session starts", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "pi-typo-abolish-headless-"));
  try {
    const result = await runProbe(
      `
const { default: extension } = await import(process.argv[1]);
let sessionStart;
extension({ on(event, handler) { if (event === "session_start") sessionStart = handler; } });
await sessionStart({ type: "session_start", reason: "startup" }, { hasUI: false });
console.log("headless");
`,
      configHome,
    );
    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "headless\n" });
  } finally {
    await rm(configHome, { force: true, recursive: true });
  }
});

test("loads typo rules for UI sessions", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "pi-typo-abolish-ui-"));
  try {
    await mkdir(join(configHome, "fbb/data"), { recursive: true });
    await writeFile(join(configHome, "fbb/data/typos.abolish"), "teh the\n");
    const result = await runProbe(
      `
const { default: extension, correctedPromptForInput, loadTypoCorrectionRules } = await import(process.argv[1]);
let sessionStart;
extension({ on(event, handler) { if (event === "session_start") sessionStart = handler; } });
await sessionStart({ type: "session_start", reason: "startup" }, { hasUI: true });
console.log(correctedPromptForInput("teh", " ", loadTypoCorrectionRules()));
`,
      configHome,
    );
    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "the \n" });
  } finally {
    await rm(configHome, { force: true, recursive: true });
  }
});

describe("prompt typo correction", () => {
  test("allows ten visible autocomplete suggestions", () => {
    const editor = createEditor();

    expect(editor.getAutocompleteMaxVisible()).toBe(10);
  });

  test.each([
    [")", ")"],
    ["/", "/"],
    ["'", "'"],
    ["\u001b[49:33;2u", "!"],
    ["\u001b[59:58;2u", ":"],
    ["\u001b[27;1;46~", "."],
  ])("corrects native printable delimiter %j", (data, delimiter) => {
    const editor = createEditor();
    editor.setText("teh");
    editor.handleInput(data);
    expect(editor.getText()).toBe(`the${delimiter}`);
    editor.dispose();
  });

  test.each(["\u001b\r", "\u001b[13;2u"])("corrects before native newline %j", (data) => {
    const editor = createEditor();
    editor.setText("teh");
    editor.handleInput(data);
    expect(editor.getText()).toBe("the\n");
    editor.handleInput("\u001f");
    expect(editor.getText()).toBe("teh");
    editor.dispose();
  });

  test("corrects before submitting without adding a delimiter", () => {
    const editor = createEditor();
    let submitted = "";
    editor.onSubmit = (text) => {
      submitted = text;
    };
    editor.setText("teh");
    editor.handleInput("\r");
    expect(submitted).toBe("the");
    expect(editor.getText()).toBe("");
    editor.dispose();
  });

  test.each(["ran", "æ", "𐐀"])("submission does not split a word before suffix %s", (suffix) => {
    const editor = createEditor();
    let submitted = "";
    editor.onSubmit = (text) => {
      submitted = text;
    };
    editor.setText(`teh${suffix}`);
    editor.handleInput("\u0001");
    for (let i = 0; i < 3; i++) editor.handleInput("\u001b[C");
    editor.handleInput("\r");
    expect(submitted).toBe(`teh${suffix}`);
    editor.dispose();
  });

  test("preserves the suffix, cursor, and atomic undo when correcting mid-prompt", () => {
    const editor = createEditor();
    editor.setText(" suffix\nnext line");
    for (let i = 0; i < 17; i++) editor.handleInput("\u001b[D");
    for (const character of "repositry") editor.handleInput(character);
    editor.handleInput(" ");
    expect(editor.getText()).toBe("repository  suffix\nnext line");
    expect(editor.getCursor()).toEqual({ line: 0, col: 11 });
    editor.handleInput("\u001f");
    expect(editor.getText()).toBe("repositry suffix\nnext line");
    expect(editor.getCursor()).toEqual({ line: 0, col: 9 });
    editor.dispose();
  });

  test("leaves bracketed paste chunks and extension shortcuts untouched", () => {
    const editor = createEditor();
    editor.setText("teh");
    editor.handleInput("\u001b[200~");
    editor.handleInput(" ");
    editor.handleInput("\u001b[201~");
    expect(editor.getText()).toBe("teh ");
    editor.setText("teh");
    editor.onExtensionShortcut = (data) => data === "!";
    editor.handleInput("!");
    expect(editor.getText()).toBe("teh");
    editor.dispose();
  });

  test("honors remapped newline and submit bindings", () => {
    const keybindings = getKeybindings();
    const original = keybindings.getUserBindings();
    keybindings.setUserBindings({
      ...original,
      "tui.input.newLine": "ctrl+n",
      "tui.input.submit": "ctrl+g",
    });
    const editor = createEditor();
    try {
      let submitted = "";
      editor.onSubmit = (text) => {
        submitted = text;
      };
      editor.setText("teh");
      editor.handleInput("\u000e");
      expect(editor.getText()).toBe("the\n");
      editor.setText("teh");
      editor.handleInput("\u0007");
      expect(submitted).toBe("the");
    } finally {
      editor.dispose();
      keybindings.setUserBindings(original);
    }
  });

  test("does not correct a disabled submission or a cursor-jump target", () => {
    const editor = createEditor();
    editor.setText("teh");
    editor.disableSubmit = true;
    editor.handleInput("\r");
    expect(editor.getText()).toBe("teh");
    editor.handleInput("\u001d");
    editor.handleInput("!");
    expect(editor.getText()).toBe("teh");
    editor.dispose();
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

  test("corrects typed words without losing expanded paste content", () => {
    const editor = createEditor();
    const pasted = "x".repeat(1001);

    editor.handleInput(`\u001b[200~${pasted}\u001b[201~`);
    for (const character of " teh") editor.handleInput(character);
    editor.handleInput(" ");

    expect(editor.getExpandedText()).toBe(`${pasted} the `);
    editor.handleInput("\u001f");
    expect(editor.getExpandedText()).toBe(`${pasted} teh`);
    editor.dispose();
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
