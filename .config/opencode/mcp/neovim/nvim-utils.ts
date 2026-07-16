export type JsonRecord = Record<string, unknown>

type ValueGuard = (value: unknown) => boolean

export function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null
}

export function isNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value)
}

export function isString(value: unknown): value is string {
	return typeof value === "string"
}

export function hasProperties(value: unknown, guards: Record<string, ValueGuard>): value is JsonRecord {
	return isRecord(value) && Object.entries(guards).every(function([key, guard]) { return guard(value[key]) })
}
