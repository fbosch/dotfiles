import { expect, test } from "bun:test";
import { assertInertBenchmarkDependencies } from "../ai-pointer-safety";

const dependencies = {
	capture: true,
	prepareDirectory: true,
	readPointer: true,
	recognizeOcr: true,
	resolveAccessibility: true,
	resolveClickGeometry: true,
	resolvePrograms: true,
	view: true,
};

test("requires every live AI Pointer dependency to be replaced", () => {
	expect(() => assertInertBenchmarkDependencies(dependencies)).not.toThrow();
	for (const name of Object.keys(dependencies)) {
		const incomplete: Record<string, unknown> = { ...dependencies };
		delete incomplete[name];
		expect(() => assertInertBenchmarkDependencies(incomplete)).toThrow(
			`AI Pointer benchmark requires inert ${name}`,
		);
	}
});
