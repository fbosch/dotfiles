import { validatedSelectionGeometry, type SelectionGeometry } from "../selection";
import { accessibilityHelperTimingMetrics } from "../performance-metrics";

const maximumCandidates = 24;
const maximumRoleLength = 80;
const maximumNameLength = 160;
const maximumUrlLength = 512;

export const accessibilityProtocolVersion = 6;
export const accessibilityCoordinateSpace = "window";

export interface AccessibleCandidate {
	centerHit?: boolean;
	geometry: SelectionGeometry;
	hitCount?: number;
	name?: string;
	role: string;
	url?: string;
}

export interface AccessibilityHelperTiming {
	durationMs: number;
	startMs: number;
}

export interface AccessibilityHelperOutput {
	candidates: AccessibleCandidate[];
	complete: boolean;
	timings: Record<keyof typeof accessibilityHelperTimingMetrics, AccessibilityHelperTiming>;
}

export function parseAccessibilityHelperOutput(output: string): AccessibilityHelperOutput | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(output);
	} catch {
		return null;
	}
	if (
		!isRecord(parsed) ||
		parsed.protocolVersion !== accessibilityProtocolVersion ||
		parsed.coordinateSpace !== accessibilityCoordinateSpace ||
		Array.isArray(parsed.candidates) === false ||
		typeof parsed.complete !== "boolean" ||
		isRecord(parsed.timings) === false
	)
		return null;
	const timings = parseHelperTimings(parsed.timings);
	if (!timings) return null;
	if (parsed.candidates.length > maximumCandidates) return null;

	const candidates: AccessibleCandidate[] = [];
	for (const value of parsed.candidates) {
		if (!isRecord(value) || !isRecord(value.geometry)) return null;
		const { x, y, width, height } = value.geometry;
		if (
			typeof x !== "number" ||
			typeof y !== "number" ||
			typeof width !== "number" ||
			typeof height !== "number"
		)
			return null;
		const geometry = validatedSelectionGeometry(x, y, width, height);
		if (
			!geometry ||
			typeof value.role !== "string" ||
			isSafeMetadata(value.role, maximumRoleLength) === false
		)
			return null;
		if (
			value.name !== undefined &&
			(typeof value.name !== "string" || isSafeMetadata(value.name, maximumNameLength) === false)
		)
			return null;
		if (
			value.url !== undefined &&
			(typeof value.url !== "string" ||
				value.role.trim().toLowerCase() !== "link" ||
				isSafeUrl(value.url) === false)
		)
			return null;
		if (value.centerHit !== undefined && typeof value.centerHit !== "boolean") return null;
		if (
			value.hitCount !== undefined &&
			(typeof value.hitCount !== "number" ||
				Number.isSafeInteger(value.hitCount) === false ||
				value.hitCount < 1 ||
				value.hitCount > 24)
		)
			return null;
		candidates.push({
			centerHit: value.centerHit,
			geometry,
			hitCount: value.hitCount,
			role: value.role,
			name: value.name,
			url: value.url,
		});
	}
	return { candidates, complete: parsed.complete, timings };
}

function parseHelperTimings(
	value: Record<string, unknown>,
): Record<keyof typeof accessibilityHelperTimingMetrics, AccessibilityHelperTiming> | null {
	const timings = {} as Record<
		keyof typeof accessibilityHelperTimingMetrics,
		AccessibilityHelperTiming
	>;
	for (const name of Object.keys(accessibilityHelperTimingMetrics) as Array<
		keyof typeof accessibilityHelperTimingMetrics
	>) {
		const timing = value[name];
		if (
			isRecord(timing) === false ||
			typeof timing.startMs !== "number" ||
			Number.isFinite(timing.startMs) === false ||
			timing.startMs < 0 ||
			typeof timing.durationMs !== "number" ||
			Number.isFinite(timing.durationMs) === false ||
			timing.durationMs < 0 ||
			timing.durationMs > 900
		)
			return null;
		timings[name] = { startMs: timing.startMs, durationMs: timing.durationMs };
	}
	return timings;
}

function isSafeMetadata(value: string, maximumLength: number): boolean {
	return value.length > 0 && value.length <= maximumLength && /[\u0000-\u001f\u007f]/.test(value) === false;
}

function isSafeUrl(value: string): boolean {
	return (
		value.length <= maximumUrlLength &&
		/[\u0000-\u0020\u007f]/.test(value) === false &&
		/^https?:\/\//i.test(value)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
