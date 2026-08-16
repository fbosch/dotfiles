import { setup } from "xstate";

type AiPointerEvent =
	| { type: "START" }
	| { type: "CAPTURED" }
	| { type: "CANCEL" }
	| { type: "FAIL" };

export const aiPointerMachine = setup({
	types: {
		events: {} as AiPointerEvent,
		tags: {} as "active" | "surface-visible",
	},
}).createMachine({
	id: "ai-pointer",
	initial: "idle",
	states: {
		idle: {
			on: { START: "selecting" },
		},
		selecting: {
			tags: ["active"],
			on: {
				CAPTURED: "preview",
				CANCEL: "idle",
				FAIL: "failed",
			},
		},
		preview: {
			tags: ["active", "surface-visible"],
			on: { CANCEL: "idle", FAIL: "failed" },
		},
		failed: {
			tags: ["active", "surface-visible"],
			on: { CANCEL: "idle" },
		},
	},
});
