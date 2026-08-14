import { assign, assertEvent, setup } from "xstate";
import type { LayoutSwitchConfig } from "./model";

export type KeyboardSwitcherEvent =
	| { type: "SHOW"; config: LayoutSwitchConfig }
	| { type: "HIDE" }
	| { type: "FAIL" };

export const keyboardSwitcherMachine = setup({
	types: {
		context: {} as { config: LayoutSwitchConfig },
		events: {} as KeyboardSwitcherEvent,
		tags: {} as "switcher-visible",
	},
	delays: {
		displayDuration: 700,
		fadeOutDuration: 60,
	},
	actions: {
		setConfig: assign({
			config: ({ event }) => {
				assertEvent(event, "SHOW");
				return event.config;
			},
		}),
	},
}).createMachine({
	id: "keyboard-switcher",
	context: {
		config: { layouts: [], activeLayout: "", size: "sm" },
	},
	initial: "hidden",
	states: {
		hidden: {
			on: {
				SHOW: { target: "visible", actions: "setConfig" },
			},
		},
		visible: {
			tags: ["switcher-visible"],
			after: { displayDuration: "hiding" },
			on: {
				SHOW: {
					target: "visible",
					reenter: true,
					actions: "setConfig",
				},
				HIDE: "hiding",
				FAIL: "hidden",
			},
		},
		hiding: {
			tags: ["switcher-visible"],
			after: { fadeOutDuration: "hidden" },
			on: {
				SHOW: { target: "visible", actions: "setConfig" },
				FAIL: "hidden",
			},
		},
	},
});
