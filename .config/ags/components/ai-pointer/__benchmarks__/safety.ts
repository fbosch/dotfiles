const requiredInertDependencies = [
	"capture",
	"prepareDirectory",
	"readPointer",
	"recognizeOcr",
	"resolveAccessibility",
	"resolveContext",
	"resolvePrograms",
	"view",
] as const;

export function assertInertBenchmarkDependencies(
	dependencies: Record<string, unknown>,
): void {
	for (const name of requiredInertDependencies) {
		if (Object.hasOwn(dependencies, name) === false)
			throw new Error(`AI Pointer benchmark requires inert ${name}`);
	}
}
