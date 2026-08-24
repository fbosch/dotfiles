export const requiredInertDependencyPaths = [
	"assistant.preflight",
	"assistant.recognizeOcr",
	"assistant.requestAnswer",
	"capture.create",
	"capture.remove",
	"desktop.prepareCaptureDirectory",
	"desktop.queryLocked",
	"desktop.readPointer",
	"desktop.setCursorOutline",
	"host.connectShutdown",
	"selection.resolveAccessibility",
	"selection.resolveClickGeometry",
	"selection.resolveContext",
	"selection.resolvePrograms",
	"view",
] as const;

export function assertInertBenchmarkDependencies(
	dependencies: object,
): void {
	for (const path of requiredInertDependencyPaths) {
		let owner: unknown = dependencies;
		for (const segment of path.split(".")) {
			if (
				typeof owner !== "object" ||
				owner === null ||
				Object.hasOwn(owner, segment) === false
			)
				throw new Error(`AI Pointer benchmark requires inert ${path}`);
			owner = (owner as Record<string, unknown>)[segment];
		}
	}
}
