import type { createRoot } from "ags";
import type app from "ags/gtk4/app";
import type * as JsxRuntime from "ags/gtk4/jsx-runtime";

declare global {
	var AgsApplication: typeof app | undefined;
	var AgsCreateRoot: typeof createRoot | undefined;
	var AgsJsxRuntime: typeof JsxRuntime | undefined;
}

export function getAiPointerApplication(): typeof app {
	const application = globalThis.AgsApplication;
	if (!application) throw new Error("AI Pointer requires the bundled AGS application");
	return application;
}

export function getAiPointerCreateRoot(): typeof createRoot {
	const create = globalThis.AgsCreateRoot;
	if (!create) throw new Error("AI Pointer requires the bundled AGS root factory");
	return create;
}

export function getAiPointerJsxRuntime(): typeof JsxRuntime {
	const runtime = globalThis.AgsJsxRuntime;
	if (!runtime) throw new Error("AI Pointer requires the bundled AGS JSX runtime");
	return runtime;
}
