import { expect, test } from "bun:test";
import {
	assertInertBenchmarkDependencies,
	requiredInertDependencyPaths,
} from "../safety";

const dependencies = {
	assistant: {
		preflight: true,
		recognizeOcr: true,
		requestAnswer: true,
	},
	capture: { create: true, remove: true },
	desktop: {
		prepareCaptureDirectory: true,
		queryLocked: true,
		readPointer: true,
		setCursorOutline: true,
	},
	host: { connectShutdown: true },
	selection: {
		resolveAccessibility: true,
		resolveClickGeometry: true,
		resolveContext: true,
		resolvePrograms: true,
	},
	view: true,
};

test("requires every live AI Pointer dependency to be replaced", () => {
	expect(() => assertInertBenchmarkDependencies(dependencies)).not.toThrow();
	for (const path of requiredInertDependencyPaths) {
		const incomplete = structuredClone(dependencies) as Record<string, unknown>;
		const segments = path.split(".");
		const name = segments.pop();
		if (!name) throw new Error("empty dependency path");
		let owner = incomplete;
		for (const segment of segments)
			owner = owner[segment] as Record<string, unknown>;
		delete owner[name];
		expect(() => assertInertBenchmarkDependencies(incomplete)).toThrow(
			`AI Pointer benchmark requires inert ${path}`,
		);
	}
});
