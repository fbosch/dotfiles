import { assign, setup } from "xstate";

type ConfirmDialogEvent =
	| { type: "SHOW"; delayMs: number }
	| { type: "HIDE" };

interface ConfirmDialogContext {
	delayMs: number;
}

export const confirmDialogMachine = setup({
	types: {
		context: {} as ConfirmDialogContext,
		events: {} as ConfirmDialogEvent,
		tags: {} as "dialog-active" | "dialog-visible",
	},
	guards: {
		hasDelay: ({ event }) => event.type === "SHOW" && event.delayMs > 0,
	},
	actions: {
		setDelay: assign({
			delayMs: ({ event }) => (event.type === "SHOW" ? event.delayMs : 0),
		}),
	},
	delays: {
		showDelay: ({ context }) => context.delayMs,
	},
}).createMachine({
	id: "confirm-dialog",
	context: { delayMs: 0 },
	initial: "hidden",
	states: {
		hidden: {
			on: {
				SHOW: [
					{ guard: "hasDelay", target: "pending", actions: "setDelay" },
					{ target: "visible", actions: "setDelay" },
				],
			},
		},
		pending: {
			tags: ["dialog-active"],
			after: { showDelay: "visible" },
			on: { HIDE: "hidden" },
		},
		visible: {
			tags: ["dialog-active", "dialog-visible"],
			on: { HIDE: "hidden" },
		},
	},
});
