import type { Position } from "vscode-languageserver-protocol/node";

export function toProtocolPosition(text: string, line: number, column: number): Position {
  if (Number.isInteger(line) === false || line < 1)
    throw new Error("line must be a positive integer");
  if (Number.isInteger(column) === false || column < 1) {
    throw new Error("column must be a positive integer");
  }
  const lines = text.split("\n");
  const content = lines[line - 1];
  if (content === undefined) throw new Error(`line ${line} is outside the document`);
  const codePoints = [...content];
  if (column > codePoints.length + 1) {
    throw new Error(`column ${column} is outside line ${line}`);
  }
  return {
    line: line - 1,
    character: codePoints.slice(0, column - 1).join("").length,
  };
}

export function fromProtocolPosition(
  text: string,
  position: Position,
): {
  readonly column: number;
  readonly line: number;
} {
  const content = text.split("\n")[position.line];
  if (content === undefined || position.character < 0 || position.character > content.length) {
    throw new Error("server returned a position outside the document");
  }
  let utf16Offset = 0;
  let codePointOffset = 0;
  for (const codePoint of content) {
    if (utf16Offset === position.character) break;
    utf16Offset += codePoint.length;
    codePointOffset += 1;
    if (utf16Offset > position.character) {
      throw new Error("server returned a position inside a surrogate pair");
    }
  }
  return { column: codePointOffset + 1, line: position.line + 1 };
}
