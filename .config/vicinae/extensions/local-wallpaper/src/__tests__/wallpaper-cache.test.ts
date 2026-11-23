import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cacheWallpaperAssignments } from "../utils/wallpaper-cache.ts";
import { buildHyprpaperConfig, parseWallpaperAssignments } from "../utils/hyprpaper-config.ts";

for (const monitors of [["__all__"], ["DP-2"], ["DP-2", "HDMI-A-2"]]) {
	test(`cached assignments survive source removal: ${monitors.join(", ")}`, async (t) => {
		const root = await mkdtemp(join(tmpdir(), "wallpaper-cache-"));
		t.after(() => rm(root, { recursive: true, force: true }));
		const source = join(root, "wallpaper.jpg");
		const cache = join(root, "cache");
		await writeFile(source, "image contents");
		const assignments = new Map(monitors.map((monitor) => [monitor, { path: source, fillMode: "contain" as const }]));
		const cached = await cacheWallpaperAssignments(assignments, cache);
		await rm(source);
		const persisted = parseWallpaperAssignments(buildHyprpaperConfig("", cached, "block"));
		for (const monitor of monitors) {
			const assignment = persisted.get(monitor)!;
			assert.equal(assignment.fillMode, "contain");
			assert.equal(await readFile(assignment.path, "utf8"), "image contents");
			assert.equal(assignments.get(monitor)!.path, source);
		}
		assert.equal((await readdir(cache)).length, 1);
		assert.deepEqual(await cacheWallpaperAssignments(cached, cache), cached);
	});
}

test("changed sources get new paths without replacing previously applied images", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "wallpaper-cache-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const source = join(root, "wallpaper.png");
	const assignments = new Map([["DP-2", { path: source, fillMode: "fill" as const }]]);
	await writeFile(source, "first crop");
	const first = await cacheWallpaperAssignments(assignments, join(root, "cache"));
	await writeFile(source, "second crop");
	const second = await cacheWallpaperAssignments(assignments, join(root, "cache"));
	assert.notEqual(first.get("DP-2")!.path, second.get("DP-2")!.path);
	assert.equal(await readFile(first.get("DP-2")!.path, "utf8"), "first crop");
	assert.equal(await readFile(second.get("DP-2")!.path, "utf8"), "second crop");
});

test("unavailable sources reject instead of producing unusable assignments", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "wallpaper-cache-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(cacheWallpaperAssignments(new Map([["DP-2", {
		path: join(root, "missing.jpg"), fillMode: "cover",
	}]]), join(root, "cache")), { code: "ENOENT" });
});
