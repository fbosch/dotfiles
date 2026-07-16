import { type Buffer, type Window } from "neovim"
import { hasProperties, isNumber, isString } from "./nvim-utils"
import type { BufferInfo, Diagnostic, VisibleWindow } from "./neovim-bridge"

const BUFFER_METADATA_GUARDS = { name: isString, loaded: isBoolean, filetype: isString, buftype: isString, modified: isBoolean }
const WINDOW_METADATA_GUARDS = { topline: isNumber, botline: isNumber }
const DIAGNOSTIC_GUARDS = { line: isNumber, column: isNumber, endLine: isNumber, endColumn: isNumber, severity: isNumber, message: isString, source: isString }

function isBoolean(value: unknown): value is boolean {
	return typeof value === "boolean"
}

function invalidMetadata(message: string): never {
	throw new Error(message)
}

function bufferMetadata(number: number, value: unknown): BufferInfo {
	if (hasProperties(value, BUFFER_METADATA_GUARDS) === false) return invalidMetadata("Neovim returned invalid buffer metadata")
	return { number, name: value.name as string, loaded: value.loaded as boolean, filetype: value.filetype as string, buftype: value.buftype as string, modified: value.modified as boolean }
}

export function isDiagnostic(value: unknown): value is Diagnostic {
	return hasProperties(value, DIAGNOSTIC_GUARDS)
}

export function isSourceBuffer(buffer: BufferInfo) {
	return buffer.name !== "" && buffer.buftype === "" && buffer.filetype !== "opencode" && buffer.filetype !== "opencode_terminal"
}

export async function bufferInfo(buffer: Buffer): Promise<BufferInfo> {
	const [name, loaded, filetype, buftype, modified] = await Promise.all([
		buffer.name,
		buffer.loaded,
		buffer.getOption("filetype"),
		buffer.getOption("buftype"),
		buffer.getOption("modified"),
	])
	return bufferMetadata(buffer.id, { name, loaded, filetype, buftype, modified })
}

export async function windowInfo(window: Window): Promise<VisibleWindow> {
	const [buffer, response] = await Promise.all([
		window.buffer,
		window.request("nvim_call_function", ["getwininfo", [window.id]]),
	])
	const [metadata, windowMetadata] = await Promise.all([bufferInfo(buffer), response])
	const viewport = Array.isArray(windowMetadata) ? windowMetadata[0] : undefined
	if (hasProperties(viewport, WINDOW_METADATA_GUARDS) === false) return invalidMetadata("Neovim returned invalid window metadata")
	return { window: window.id, buffer: metadata.number, name: metadata.name, filetype: metadata.filetype, buftype: metadata.buftype, topline: viewport.topline as number, botline: viewport.botline as number }
}
