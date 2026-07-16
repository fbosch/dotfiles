import { hasProperties, isNumber, isString } from "./nvim-utils"
import type { BufferInfo, Diagnostic } from "./neovim-bridge"

const DIAGNOSTIC_GUARDS = { line: isNumber, column: isNumber, endLine: isNumber, endColumn: isNumber, severity: isNumber, message: isString, source: isString }

export function isDiagnostic(value: unknown): value is Diagnostic {
	return hasProperties(value, DIAGNOSTIC_GUARDS)
}

export function isSourceBuffer(buffer: BufferInfo) {
	return buffer.name !== "" && buffer.buftype === "" && buffer.filetype !== "opencode" && buffer.filetype !== "opencode_terminal"
}
