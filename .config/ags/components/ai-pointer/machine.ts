import { setup } from "xstate";

type AiPointerEvent =
	| { type: "START" }
	| { type: "READY" }
	| { type: "CAPTURED" }
	| { type: "SUBMIT" }
	| { type: "ANSWERED" }
	| { type: "CANCEL" }
	| { type: "FAIL" };

export const aiPointerMachine = setup({
	types: {
		events: {} as AiPointerEvent,
		tags: {} as "active" | "selector-active" | "surface-visible",
	},
}).createMachine({
	id: "ai-pointer",
	initial: "idle",
	states: {
		idle: {
			on: { START: "preflighting" },
		},
		preflighting: {
			tags: ["active", "selector-active"],
			on: { READY: "selecting", CANCEL: "idle", FAIL: "failed" },
		},
		selecting: {
			tags: ["active", "selector-active"],
			on: {
				CAPTURED: "composition",
				CANCEL: "idle",
				FAIL: "failed",
			},
		},
		composition: {
			tags: ["active", "surface-visible"],
			on: { SUBMIT: "requesting", CANCEL: "idle", FAIL: "failed" },
		},
		requesting: {
			tags: ["active", "surface-visible"],
			on: { ANSWERED: "answered", CANCEL: "idle", FAIL: "failed" },
		},
		answered: {
			tags: ["active", "surface-visible"],
			on: { CANCEL: "idle" },
		},
		failed: {
			tags: ["active", "surface-visible"],
			on: { CANCEL: "idle" },
		},
	},
});
