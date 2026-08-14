import { setup } from "xstate";

export type VolumeIndicatorEvent = { type: "SHOW" } | { type: "HIDE" } | { type: "FAIL" };

export const volumeIndicatorMachine = setup({
	types: {
		events: {} as VolumeIndicatorEvent,
		tags: {} as "indicator-visible",
	},
	delays: {
		displayDuration: 1500,
		fadeOutDuration: 60,
	},
}).createMachine({
	id: "volume-indicator",
	initial: "hidden",
	states: {
		hidden: { on: { SHOW: "visible" } },
		visible: {
			tags: ["indicator-visible"],
			after: { displayDuration: "hiding" },
			on: {
				SHOW: { target: "visible", reenter: true },
				HIDE: "hiding",
				FAIL: "hidden",
			},
		},
		hiding: {
			tags: ["indicator-visible"],
			after: { fadeOutDuration: "hidden" },
			on: {
				SHOW: "visible",
				FAIL: "hidden",
			},
		},
	},
});
