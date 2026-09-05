import GdkPixbuf from "gi://GdkPixbuf?version=2.0";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import type { WindowInfo } from "@/components/window-switcher/machine";
import { PreviewCache } from "@/components/window-switcher/preview-cache";
import { assert, test } from "./harness";

test("Window Switcher decodes and caches preview textures", async () => {
	await withPreviewEnvironment(async ({ previewDirectory }) => {
		const fixturePath = `${previewDirectory}/decoded.jpg`;
		writePreview(fixturePath);
		const cache = new PreviewCache(() => {});
		try {
			const fallback = cache.getInfo(null, { width: 1920, height: 1080 });
			assert(
				fallback.width === 320 && fallback.height === 180,
				"fallback dimensions did not preserve window proportions",
			);
			const decoded = cache.getInfo(fixturePath);
			assert(decoded.texture !== undefined, "decoded preview has no texture");
			assert(
				decoded.width > 0 && decoded.height > 0,
				"decoded preview has invalid dimensions",
			);

			const cached = cache.getInfo(fixturePath);
			assert(cached.texture !== undefined, "cached preview has no texture");
			assert(cached === decoded, "second preview read did not use the cache");
			assert(cache.getMtime(fixturePath) !== null, "preview mtime was unavailable");
			assert(cache.getMtime(null) === null, "null preview had an mtime");
			cache.startMonitoring();
			cache.startMonitoring();
		} finally {
			cache.dispose();
			cache.dispose();
		}
	});
});

test("Window Switcher keeps preview lookup inside the Hyprland instance", async () => {
	await withPreviewEnvironment(async ({ runtimeDirectory }) => {
		const stableId = "same-stable-id";
		const address = "address-a";
		GLib.setenv("HYPRLAND_INSTANCE_SIGNATURE", "instance-a", true);
		const launcher = new Gio.SubprocessLauncher({
			flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
		});
		// AGS runs native tests from scripts/tests/gjs.
		launcher.set_cwd(GLib.canonicalize_filename("../../../../hypr", GLib.get_current_dir()));
		const lua = launcher.spawnv([
			"luajit",
			"-e",
			'io.write(require("runtime.lib.hypr-ipc").instance_path("window-captures"))',
		]);
		const [success, instanceA, diagnostic] = lua.communicate_utf8(null, null);
		assert(success && lua.get_successful(), `Lua instance path failed: ${diagnostic}`);
		const instanceB = previewDirectoryFor(runtimeDirectory, "instance-b");
		assert(
			instanceA === `${runtimeDirectory}/hypr/instance-a/window-captures`,
			"preview directory did not match the Hyprland instance path",
		);
		const stablePathA = `${instanceA}/${stableId}.jpg`;
		const addressPathA = `${instanceA}/${address}.jpg`;
		const stablePathB = `${instanceB}/${stableId}.jpg`;
		writePreview(stablePathA);
		writePreview(addressPathA);
		const window: WindowInfo = {
			address: `0x${address}`,
			stableId,
			class: "Test",
			title: "Test",
			workspace: "1",
		};

		GLib.setenv("HYPRLAND_INSTANCE_SIGNATURE", "instance-a", true);
		const cacheA = new PreviewCache(() => {});
		try {
			assert(
				cacheA.getPath(window) === stablePathA,
				"stable ID did not take precedence in instance A",
			);

			GLib.setenv("HYPRLAND_INSTANCE_SIGNATURE", "instance-b", true);
			const cacheB = new PreviewCache(() => {});
			try {
				assert(
					cacheA.getPath(window) === stablePathA,
					"cache did not retain its construction-time instance",
				);
				assert(
					cacheB.getPath(window) === null,
					"instance B crossed over to instance A's preview",
				);
				writePreview(stablePathB);
				assert(
					cacheB.getPath(window) === stablePathB,
					"cache did not resolve the second instance directory",
				);
				assert(cacheB.getInfo(stablePathA).texture === undefined, "decoded another instance's preview");
				GLib.unlink(stablePathA);
				assert(cacheA.getPath(window) === addressPathA, "address fallback was not preserved");
			} finally {
				cacheB.dispose();
			}
		} finally {
			cacheA.dispose();
		}
	});
});

test("Window Switcher disables preview reads when identity is missing", async () => {
	await withPreviewEnvironment(async ({ runtimeDirectory }) => {
		const fixturePath = `${runtimeDirectory}/outside.jpg`;
		writePreview(fixturePath);
		const window: WindowInfo = {
			address: "0xaddress",
			stableId: "stable-id",
			class: "Test",
			title: "Test",
			workspace: "1",
		};

		for (const missingVariable of [
			"XDG_RUNTIME_DIR",
			"HYPRLAND_INSTANCE_SIGNATURE",
		] as const) {
			GLib.setenv("XDG_RUNTIME_DIR", runtimeDirectory, true);
			GLib.setenv("HYPRLAND_INSTANCE_SIGNATURE", "instance", true);
			GLib.unsetenv(missingVariable);
			const cache = new PreviewCache(() => {});
			try {
				cache.startMonitoring();
				assert(
					cache.getPath(window) === null,
					`${missingVariable} still resolved a preview`,
				);
				assert(
					cache.getMtime(fixturePath) === null,
					`${missingVariable} still read an mtime`,
				);
				assert(
					cache.getInfo(fixturePath).texture === undefined,
					`${missingVariable} still decoded a preview`,
				);
			} finally {
				cache.dispose();
			}
		}
	});
});

test("Window Switcher preserves previews across cache disposal", async () => {
	await withPreviewEnvironment(async ({ previewDirectory }) => {
		const fixturePath = `${previewDirectory}/survives.jpg`;
		writePreview(fixturePath);
		const window: WindowInfo = {
			address: "0xsurvives",
			stableId: "survives",
			class: "Test",
			title: "Test",
			workspace: "1",
		};
		const firstCache = new PreviewCache(() => {});
		try {
			assert(firstCache.getPath(window) === fixturePath, "initial preview was not found");
			assert(
				firstCache.getInfo(fixturePath).texture !== undefined,
				"initial preview was not decoded",
			);
		} finally {
			firstCache.dispose();
		}

		const secondCache = new PreviewCache(() => {});
		try {
			assert(
				secondCache.getPath(window) === fixturePath,
				"preview did not survive cache disposal",
			);
			assert(
				secondCache.getInfo(fixturePath).texture !== undefined,
				"same-instance preview was not reusable",
			);
			assert(
				Gio.File.new_for_path(fixturePath).query_exists(null),
				"preview reader deleted the capture",
			);
		} finally {
			secondCache.dispose();
		}
	});
});

test("Window Switcher can watch previews after directory creation fails", async () => {
	await withPreviewEnvironment(async ({ previewDirectory }) => {
		const parentPath = GLib.path_get_dirname(previewDirectory);
		GLib.mkdir_with_parents(GLib.path_get_dirname(parentPath), 0o700);
		GLib.file_set_contents(parentPath, "not a directory");
		const cache = new PreviewCache(() => {});
		try {
			cache.startMonitoring();
			cache.startMonitoring();
			assert(cache.getPath({ address: "0xblocked" } as WindowInfo) === null, "blocked directory exposed a preview");
			GLib.unlink(parentPath);
			cache.startMonitoring();
			assert(GLib.file_test(previewDirectory, GLib.FileTest.IS_DIR), "monitor did not recover after directory became writable");
		} finally {
			cache.dispose();
		}
	});
});

test("Window Switcher monitors a missing directory before first publication", async () => {
	await withPreviewEnvironment(async ({ previewDirectory }) => {
		let changes = 0;
		let timeoutId = 0;
		let resolveChange = () => {};
		let rejectChange = (_error: Error) => {};
		const firstChange = new Promise<void>((resolve, reject) => {
			resolveChange = resolve;
			rejectChange = reject;
		});
		const cache = new PreviewCache(() => {
			changes += 1;
			if (timeoutId !== 0) {
				GLib.source_remove(timeoutId);
				timeoutId = 0;
			}
			resolveChange();
		});
		const window: WindowInfo = {
			address: "0xpublished",
			stableId: "published",
			class: "Test",
			title: "Test",
			workspace: "1",
		};
		const publishedPath = `${previewDirectory}/published.jpg`;
		try {
			cache.startMonitoring();
			assert(
				Gio.File.new_for_path(previewDirectory).query_exists(null),
				"monitoring did not create the missing preview directory",
			);
			timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
				timeoutId = 0;
				rejectChange(new Error("preview monitor did not report publication"));
				return GLib.SOURCE_REMOVE;
			});
			const temporaryPath = `${previewDirectory}/published.tmp`;
			writePreview(temporaryPath);
			Gio.File.new_for_path(temporaryPath).move(
				Gio.File.new_for_path(publishedPath),
				Gio.FileCopyFlags.NONE,
				null,
				null,
			);
			await firstChange;
			await delay(50);
			assert(changes > 0, "preview monitor did not notify for first publication");
			assert(cache.getPath(window) === publishedPath, "published preview was not found");
			const changesBeforeDispose = changes;
			cache.dispose();

			const secondTemporaryPath = `${previewDirectory}/after-dispose.tmp`;
			writePreview(secondTemporaryPath);
			Gio.File.new_for_path(secondTemporaryPath).move(
				Gio.File.new_for_path(`${previewDirectory}/after-dispose.jpg`),
				Gio.FileCopyFlags.NONE,
				null,
				null,
			);
			await delay(100);
			assert(changes === changesBeforeDispose, "disposed preview monitor still notified");
		} finally {
			if (timeoutId !== 0) GLib.source_remove(timeoutId);
			cache.dispose();
		}
	});
});

async function withPreviewEnvironment(
	run: (environment: {
		runtimeDirectory: string;
		previewDirectory: string;
	}) => Promise<void> | void,
): Promise<void> {
	const originalRuntimeDirectory = GLib.getenv("XDG_RUNTIME_DIR");
	const originalInstanceSignature = GLib.getenv("HYPRLAND_INSTANCE_SIGNATURE");
	const runtimeDirectory = GLib.build_filenamev([
		GLib.get_tmp_dir(),
		`ags-window-switcher-preview-test-${GLib.uuid_string_random()}`,
	]);
	const previewDirectory = previewDirectoryFor(runtimeDirectory, "test-instance");
	GLib.setenv("XDG_RUNTIME_DIR", runtimeDirectory, true);
	GLib.setenv("HYPRLAND_INSTANCE_SIGNATURE", "test-instance", true);
	try {
		await run({ runtimeDirectory, previewDirectory });
	} finally {
		if (originalRuntimeDirectory !== null)
			GLib.setenv("XDG_RUNTIME_DIR", originalRuntimeDirectory, true);
		else GLib.unsetenv("XDG_RUNTIME_DIR");
		if (originalInstanceSignature !== null)
			GLib.setenv("HYPRLAND_INSTANCE_SIGNATURE", originalInstanceSignature, true);
		else GLib.unsetenv("HYPRLAND_INSTANCE_SIGNATURE");
		removeTree(Gio.File.new_for_path(runtimeDirectory));
	}
}

function previewDirectoryFor(runtimeDirectory: string, instanceSignature: string): string {
	return GLib.build_filenamev([
		runtimeDirectory,
		"hypr",
		instanceSignature,
		"window-captures",
	]);
}

function writePreview(path: string): void {
	const parent = Gio.File.new_for_path(path).get_parent();
	if (!parent) throw new Error(`Preview has no parent directory: ${path}`);
	GLib.mkdir_with_parents(parent.get_path() ?? ".", 0o700);
	const fixture = GdkPixbuf.Pixbuf.new(
		GdkPixbuf.Colorspace.RGB,
		false,
		8,
		4,
		2,
	);
	assert(fixture !== null, "failed to create preview fixture");
	fixture.fill(0x336699ff);
	fixture.savev(path, "jpeg", [], []);
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
			resolve();
			return GLib.SOURCE_REMOVE;
		});
	});
}

function removeTree(file: Gio.File): void {
	let enumerator: Gio.FileEnumerator | null = null;
	try {
		enumerator = file.enumerate_children(
			"standard::name,standard::type",
			Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
			null,
		);
		while (true) {
			const info = enumerator.next_file(null);
			if (!info) break;
			removeTree(file.get_child(info.get_name()));
		}
	} catch {
		// A regular file has no children.
	} finally {
		enumerator?.close(null);
	}
	try {
		file.delete(null);
	} catch {
		// Failed tests should not hide their original assertion behind fixture cleanup.
	}
}
