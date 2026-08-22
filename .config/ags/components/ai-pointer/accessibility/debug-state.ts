import type { AccessibilityCandidateDiagnostic } from "./policy";

export type AccessibilityRegionKind = "box" | "click";

export type AccessibilityDebugState =
	| { kind: "pending"; regionKind: AccessibilityRegionKind }
	| { kind: "unavailable"; regionKind: AccessibilityRegionKind; reason: string }
	| { kind: "empty"; regionKind: AccessibilityRegionKind }
	| {
		kind: "evaluated";
		regionKind: AccessibilityRegionKind;
		candidateCount: number;
		diagnostics: AccessibilityCandidateDiagnostic[];
		partial: boolean;
	};

export function accessibilityDebugLabel(state: AccessibilityDebugState): string {
	switch (state.kind) {
		case "pending":
			return `a11y: ${state.regionKind} pending`;
		case "unavailable":
			return `a11y: ${state.regionKind} unavailable: ${state.reason}`;
		case "empty":
			return `a11y: ${state.regionKind} no candidates`;
		case "evaluated":
			return `a11y: ${state.regionKind} ${state.candidateCount} candidates${state.partial ? " (partial)" : ""}`;
	}
}
