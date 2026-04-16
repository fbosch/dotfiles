import assert from "node:assert/strict";
import test from "node:test";
import {
	buildHyprpaperConfig,
	parseWallpaperAssignments,
} from "./hyprpaper-config.ts";

test("parseWallpaperAssignments reads legacy and block syntax", () => {
	const config = `
splash = false
wallpaper = DP-1,/wall/a.jpg
wallpaper {
  monitor = HDMI-A-1
  path = /wall/b.png
  fit_mode = contain
}
wallpaper {
  path = /wall/all.webp
  fit_mode = tile
}
`;

	const parsed = parseWallpaperAssignments(config);
	assert.deepEqual(parsed.get("DP-1"), {
		path: "/wall/a.jpg",
		fillMode: "cover",
	});
	assert.deepEqual(parsed.get("HDMI-A-1"), {
		path: "/wall/b.png",
		fillMode: "contain",
	});
	assert.deepEqual(parsed.get("__all__"), {
		path: "/wall/all.webp",
		fillMode: "tile",
	});
});

test("buildHyprpaperConfig writes block syntax without all-monitor field", () => {
	const sourceConfig = `
splash = false
ipc = true
wallpaper = DP-1,/old/path.jpg
`;

	const assignments = new Map([
		[
			"__all__",
			{
				path: "/wall/new.jpg",
				fillMode: "contain",
			},
		],
	]);

	const rendered = buildHyprpaperConfig(sourceConfig, assignments, "block");

	assert.equal(rendered.includes("monitor = __all__"), false);
	assert.equal(rendered.includes("monitor ="), false);
	assert.equal(rendered.includes("path = /wall/new.jpg"), true);
	assert.equal(rendered.includes("fit_mode = contain"), true);
	assert.equal(rendered.endsWith("\n"), true);
});

test("buildHyprpaperConfig writes legacy syntax for all monitors", () => {
	const assignments = new Map([
		[
			"__all__",
			{
				path: "/wall/new.jpg",
				fillMode: "cover",
			},
		],
	]);

	const rendered = buildHyprpaperConfig("splash = false\n", assignments, "legacy");
	assert.equal(rendered.includes("wallpaper = ,/wall/new.jpg"), true);
});
