import { describe, expect, test } from "bun:test";
import {
	fallbackPreviewDimensions,
	scaledPreviewDimensions,
} from "../preview-policy";

describe("scaledPreviewDimensions", () => {
	test("preserves a normal aspect ratio", () => {
		expect(scaledPreviewDimensions(800, 600)).toEqual({ width: 240, height: 180 });
	});

	test("caps wide previews", () => {
		expect(scaledPreviewDimensions(4000, 1000)).toEqual({ width: 320, height: 80 });
	});

	test("enforces the minimum preview width", () => {
		expect(scaledPreviewDimensions(1, 100)).toEqual({ width: 30, height: 180 });
	});

	test("uses the window proportions for image-less previews", () => {
		expect(fallbackPreviewDimensions({ width: 1920, height: 1080 })).toEqual({
			width: 320,
			height: 180,
		});
		expect(fallbackPreviewDimensions({ width: 900, height: 1600 })).toEqual({
			width: 101,
			height: 180,
		});
	});

	test("uses default dimensions when window geometry is unavailable", () => {
		expect(fallbackPreviewDimensions()).toEqual({ width: 30, height: 180 });
	});
});
