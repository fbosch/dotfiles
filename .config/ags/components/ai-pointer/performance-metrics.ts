export const accessibilityHelperTimingMetrics = {
	initialization: "accessibilityHelperInitialization",
	applicationDiscovery: "accessibilityApplicationDiscovery",
	windowMatching: "accessibilityWindowMatching",
	hitTesting: "accessibilityHitTesting",
	ancestorTraversal: "accessibilityAncestorTraversal",
	candidateInspection: "accessibilityCandidateInspection",
	serialization: "accessibilitySerialization",
} as const;

export const aiPointerPerformanceMetrics = {
	...accessibilityHelperTimingMetrics,
	accessibilityHelperResponse: "accessibilityHelperResponse",
	accessibilityHelperSpawn: "accessibilityHelperSpawn",
	accessibilityLookup: "accessibilityLookup",
	capture: "capture",
	ocrCompletion: "ocrCompletion",
	overlayTeardown: "overlayTeardown",
	previewPresentation: "previewPresentation",
	workflowCompletion: "workflowCompletion",
} as const;
