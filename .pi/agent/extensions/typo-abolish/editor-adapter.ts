import type { Editor } from "@earendil-works/pi-tui";
import { correctedPromptForInput, type TypoCorrectionRules } from ".";
import { isTypoDelimiter } from "./typo-engine";

interface NativeEditor {
  state: { lines: string[]; cursorLine: number; cursorCol: number };
  lastAction: string | null;
  insertCharacter(character: string, skipUndoCoalescing?: boolean): void;
  addNewLine(): void;
  submitValue(): void;
  insertTextAtCursorInternal(text: string): void;
  pushUndoSnapshot(): void;
  cancelAutocomplete(): void;
  exitHistoryBrowsing(): void;
  setCursorCol(column: number): void;
}

function assertNativeEditor(value: unknown): asserts value is NativeEditor {
  if (typeof value !== "object" || value === null) throw new Error("Expected a Pi editor");
  const fields = value as Record<string, unknown>;
  const state = fields.state;
  if (
    typeof state !== "object" ||
    state === null ||
    !("lines" in state) ||
    !Array.isArray(state.lines) ||
    !state.lines.every((line: unknown) => typeof line === "string") ||
    !("cursorLine" in state) ||
    !Number.isInteger(state.cursorLine) ||
    !("cursorCol" in state) ||
    !Number.isInteger(state.cursorCol) ||
    !(fields.lastAction === null || typeof fields.lastAction === "string") ||
    ![
      "insertCharacter",
      "addNewLine",
      "submitValue",
      "insertTextAtCursorInternal",
      "pushUndoSnapshot",
      "cancelAutocomplete",
      "exitHistoryBrowsing",
      "setCursorCol",
    ].every((name) => typeof fields[name] === "function")
  ) {
    throw new Error("Pi editor contract changed; update the typo-correction adapter");
  }
}

// shortcut: Pi has no public atomic range-edit API. Replace this adapter when it does.
// Hook native edits, not raw input: Pi retains ownership of decoding, shortcuts,
// autocomplete, paste buffering, and jump mode.
export function installTypoCorrection(
  editor: Editor,
  rules: TypoCorrectionRules,
  allowed: (line: string, column: number) => boolean,
): void {
  const candidate: unknown = editor;
  assertNativeEditor(candidate);
  const native = candidate;
  const insert = native.insertCharacter;
  const newline = native.addNewLine;
  const submit = native.submitValue;

  function correct(delimiter: string): boolean {
    const { lines, cursorLine, cursorCol } = native.state;
    const line = lines[cursorLine];
    if (line === undefined || !allowed(line, cursorCol)) return false;
    // Submission inserts no boundary; an interior cursor must not split a word.
    if (delimiter === "") {
      const following = [...line.slice(cursorCol)][0];
      if (following !== undefined && !isTypoDelimiter(following)) return false;
    }
    const prefix = line.slice(0, cursorCol);
    const corrected = correctedPromptForInput(prefix, delimiter, rules);
    if (corrected === undefined) return false;
    const replacement = corrected.slice(0, corrected.length - delimiter.length);
    native.pushUndoSnapshot();
    native.cancelAutocomplete();
    native.exitHistoryBrowsing();
    native.lastAction = null;
    lines[cursorLine] = replacement + line.slice(cursorCol);
    native.setCursorCol(replacement.length);
    return true;
  }

  native.insertCharacter = (character, skipUndoCoalescing) => {
    const corrected = correct(character);
    insert.call(editor, character, corrected || skipUndoCoalescing);
    if (corrected) native.lastAction = null;
  };
  native.addNewLine = () => {
    if (correct("\n")) {
      // The correction already captured the pre-edit state, including paste payloads.
      native.insertTextAtCursorInternal("\n");
    } else {
      newline.call(editor);
    }
  };
  native.submitValue = () => {
    correct("");
    submit.call(editor);
  };
}
