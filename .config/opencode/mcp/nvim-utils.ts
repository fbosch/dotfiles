export type JsonRecord = Record<string, unknown>

export function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null
}

export function isNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value)
}

export function isString(value: unknown): value is string {
	return typeof value === "string"
}
