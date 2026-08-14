import { describe, expect, test } from "bun:test";
import {
	createVolumePresentation,
	parseWpctlVolume,
	shouldPlayVolumeSound,
} from "../model";

describe("volume indicator model", () => {
	test("maps volume thresholds to speaker states", () => {
		expect(createVolumePresentation({ volume: 0, muted: false }).speakerState).toBe("muted");
		expect(createVolumePresentation({ volume: 10, muted: false }).speakerState).toBe("verylow");
		expect(createVolumePresentation({ volume: 20, muted: false }).speakerState).toBe("low");
		expect(createVolumePresentation({ volume: 40, muted: false }).speakerState).toBe("medium");
		expect(createVolumePresentation({ volume: 70, muted: false }).speakerState).toBe("high");
		expect(createVolumePresentation({ volume: 100, muted: false }).speakerState).toBe("veryhigh");
		expect(createVolumePresentation({ volume: 100, muted: true }).speakerState).toBe("muted");
	});

	test("parses wpctl volume and mute state", () => {
		expect(parseWpctlVolume("Volume: 0.42")).toEqual({
			volume: 42,
			muted: false,
		});
		expect(parseWpctlVolume("Volume: 1.00 [MUTED]")).toEqual({
			volume: 100,
			muted: true,
		});
	});

	test("clamps presentation and uses the design-system segment count", () => {
		expect(createVolumePresentation({ volume: 150, muted: false })).toMatchObject({
			volume: 100,
			label: "100%",
			filledSegments: 16,
		});
		expect(createVolumePresentation({ volume: -10, muted: true })).toMatchObject({
			volume: 0,
			label: "Muted",
			filledSegments: 0,
		});
	});

	test("plays feedback only for audible segment changes", () => {
		const low = createVolumePresentation({ volume: 20, muted: false });
		const high = createVolumePresentation({ volume: 80, muted: false });
		const muted = createVolumePresentation({ volume: 80, muted: true });
		const zero = createVolumePresentation({ volume: 0, muted: false });
		expect(shouldPlayVolumeSound(null, low)).toBe(false);
		expect(shouldPlayVolumeSound(low, high)).toBe(true);
		expect(shouldPlayVolumeSound(high, muted)).toBe(false);
		expect(shouldPlayVolumeSound(low, zero)).toBe(false);
	});
});
