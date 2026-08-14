import { setup } from "xstate";

export type VolumeIndicatorEvent = { type: "SHOW" } | { type: "HIDE" } | { type: "FAIL" };

export const volumeIndicatorMachine = setup({
	types: {
		events: {} as VolumeIndicatorEvent,
		tags: {} as "indicator-visible",
	},
	delays: {
		displayDuration: 1500,
	},
}).createMachine({
	id: "volume-indicator",
	initial: "hidden",
	states: {
		hidden: { on: { SHOW: "visible" } },
		visible: {
			tags: ["indicator-visible"],
			after: { displayDuration: "hidden" },
			on: {
				SHOW: { target: "visible", reenter: true },
				HIDE: "hidden",
				FAIL: "hidden",
			},
		},
	},
});
