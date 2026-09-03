import { createRoot } from "ags";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import type { WindowSwitcherController } from "@/components/window-switcher/controller";
import { WindowSwitcherController as RealWindowSwitcherController } from "@/components/window-switcher/controller";
import type { WindowInfo } from "@/components/window-switcher/machine";
import {
	ModifierController,
	modifierMaskFor,
} from "@/components/window-switcher/modifier-controller";
import { PreviewCache } from "@/components/window-switcher/preview-cache";
import { createRequestHandler } from "@/components/window-switcher/request-handler";
import { DisplayMode } from "@/components/window-switcher/styles";
import { rewriteWaybarTaskbarTitle } from "@/services/app-icons";
import {
	SortMode,
	WindowRepository,
} from "@/components/window-switcher/window-repository";
import { WindowSwitcherView } from "@/components/window-switcher/window-switcher-view";
import { assert, test } from "./harness";

const windows: WindowInfo[] = [
	{ address: "0x1", class: "One", title: "Window One", workspace: "1" },
	{ address: "0x2", class: "Two", title: "Window Two", workspace: "2" },
	{ address: "0x3", class: "Three", title: "Window Three", workspace: "3" },
];

test("Window Switcher loads Waybar taskbar title rewrites", () => {
	assert(
		rewriteWaybarTaskbarTitle(
			"Baldur's Gate 3 (3440x1391) - (Vulkan) - (6 + 6 WT)",
		) === "Baldur's Gate 3",
		"Waybar title rewrite was not applied",
	);
});

test("Window Switcher dispatches every request action", async () => {
	const calls: string[] = [];
	let displayMode = DisplayMode.PREVIEWS;
	let sortMode = SortMode.RECENCY;
	let visible = false;
	const controller = {
		show: async () => calls.push("show"),
		next: async (modifier?: string) => calls.push(`next:${modifier ?? "ALT"}`),
		prev: async (modifier?: string) => calls.push(`prev:${modifier ?? "ALT"}`),
		commit: () => calls.push("commit"),
		hide: () => calls.push("hide"),
		setMode: (mode?: string) => `mode:${mode}`,
		toggleMode: () => {
			displayMode =
				displayMode === DisplayMode.PREVIEWS
					? DisplayMode.ICONS
					: DisplayMode.PREVIEWS;
		},
		setSortMode: async (mode?: string) => {
			sortMode = mode === "alphabetical" ? SortMode.ALPHABETICAL : SortMode.RECENCY;
			return `sort:${mode}`;
		},
		get displayMode() {
			return displayMode;
		},
		get sortMode() {
			return sortMode;
		},
		isVisible: () => visible,
	} as unknown as WindowSwitcherController;
	const handleRequest = createRequestHandler(controller);

	assert((await request(handleRequest, [])) === "ready", "empty request failed");
	assert(
		(await request(handleRequest, ["not-json"])).startsWith("error:"),
		"invalid JSON did not fail",
	);
	assert(
		(await request(handleRequest, [JSON.stringify({ action: "missing" })])) ===
			"unknown action",
		"unknown action failed",
	);
	assert(
		(await request(handleRequest, [JSON.stringify({ action: "show" })])) === "shown",
		"show failed",
	);
	assert(
		(await request(handleRequest, [JSON.stringify({ action: "next", triggerModifier: "SUPER" })])) ===
			"cycled next",
		"next failed",
	);
	assert(
		(await request(handleRequest, [JSON.stringify({ action: "prev" })])) ===
			"cycled prev",
		"previous failed",
	);
	assert(
		(await request(handleRequest, [JSON.stringify({ action: "commit" })])) ===
			"committed",
		"commit failed",
	);
	assert(
		(await request(handleRequest, [JSON.stringify({ action: "hide" })])) === "hidden",
		"hide failed",
	);
	assert(
		(await request(handleRequest, [JSON.stringify({ action: "set-mode", mode: "icons" })])) ===
			"mode:icons",
		"set mode failed",
	);
	assert(
		(await request(handleRequest, [JSON.stringify({ action: "toggle-mode" })])) ===
			"mode toggled to ICONS",
		"toggle mode failed",
	);
	assert(
		(await request(handleRequest, [JSON.stringify({ action: "set-sort-mode", mode: "alphabetical" })])) ===
			"sort:alphabetical",
		"set sort mode failed",
	);
	assert(
		(await request(handleRequest, [JSON.stringify({ action: "get-sort-mode" })])) ===
			"current sort mode: ALPHABETICAL",
		"get sort mode failed",
	);
	assert(
		(await request(handleRequest, [JSON.stringify({ action: "get-mode" })])) ===
			"current mode: ICONS",
		"get mode failed",
	);
	assert(
		(await request(handleRequest, [JSON.stringify({ action: "get-visibility" })])) ===
			"hidden",
		"hidden visibility failed",
	);
	visible = true;
	assert(
		(await request(handleRequest, [JSON.stringify({ action: "get-visibility" })])) ===
			"visible",
		"visible visibility failed",
	);
	assert(calls.includes("next:SUPER"), "next modifier was not forwarded");
	const failingHandler = createRequestHandler({
		show: async () => {
			throw new Error("query failed");
		},
	} as unknown as WindowSwitcherController);
	assert(
		(await request(failingHandler, [JSON.stringify({ action: "show" })])) ===
			"error: Error: query failed",
		"async request failure was not reported",
	);
});

test("Window Switcher view renders and updates both display modes", () => {
	createRoot((dispose) => {
		const calls: string[] = [];
		const previews = new PreviewCache(() => {});
		const view = new WindowSwitcherView(previews, {
			onSelect: (index) => calls.push(`select:${index}`),
			onCommit: () => calls.push("commit"),
		});
		const window = view.create();
		view.render({ windows, currentIndex: 0 }, DisplayMode.ICONS);
		view.render({ windows, currentIndex: 1 }, DisplayMode.ICONS);
		for (const button of collectButtons(window)) button.emit("clicked");
		view.render({ windows, currentIndex: 2 }, DisplayMode.PREVIEWS);
		view.reset();
		view.render({ windows: windows.slice(0, 2), currentIndex: 0 }, DisplayMode.ICONS);
		view.show();
		view.hide();
		previews.dispose();
		assert(calls.includes("select:0"), "button selection was not emitted");
		assert(calls.includes("commit"), "button commit was not emitted");
		view.dispose();
		dispose();
	});
});

test("Window Switcher refreshes previews without rebuilding buttons", () => {
	createRoot((dispose) => {
		let mtime = 1;
		let width = 120;
		let pathQueries = 0;
		let infoQueries = 0;
		const previews = {
			getPath: (window: WindowInfo) => {
				pathQueries += 1;
				return `/preview/${window.address}.jpg`;
			},
			getInfo: () => {
				infoQueries += 1;
				return { mtime, width, height: 90 };
			},
		} as unknown as PreviewCache;
		const view = new WindowSwitcherView(previews, {
			onSelect: () => {},
			onCommit: () => {},
		});
		const window = view.create();
		view.render({ windows, currentIndex: 0 }, DisplayMode.PREVIEWS);
		const before = collectButtons(window);
		const previewBody = findWidgetWithClass(window, "preview-body");
		assert(pathQueries === windows.length, "preview path was queried repeatedly");
		assert(infoQueries === windows.length, "preview info was queried repeatedly");
		assert(
			previewBody?.widthRequest === 120,
			"initial preview width failed",
		);

		mtime = 2;
		width = 180;
		view.refreshPreviews(windows);
		const after = collectButtons(window);

		assert(before.length === after.length, "preview refresh changed button count");
		assert(
			before.every((button, index) => button === after[index]),
			"preview refresh rebuilt a button",
		);
		assert(
			previewBody.widthRequest === 180,
			"preview width was not updated",
		);
		view.dispose();
		dispose();
	});
});

test("Window Switcher reorders existing buttons with current click indices", () => {
	createRoot((dispose) => {
		const selections: number[] = [];
		const previews = new PreviewCache(() => {});
		const view = new WindowSwitcherView(previews, {
			onSelect: (index) => selections.push(index),
			onCommit: () => {},
		});
		const window = view.create();
		view.render({ windows, currentIndex: 0 }, DisplayMode.ICONS);
		const before = collectButtons(window);
		const reordered = [windows[2], windows[0], windows[1]];

		view.render({ windows: reordered, currentIndex: 0 }, DisplayMode.ICONS);
		const after = collectButtons(window);

		assert(
			before.every((button) => after.includes(button)),
			"recency reorder rebuilt a button",
		);
		for (const button of after) button.emit("clicked");
		assert(selections.join(",") === "0,1,2", "reordered click indices were stale");
		view.dispose();
		previews.dispose();
		dispose();
	});
});

test("Window Switcher modifier watcher owns and removes its timer", async () => {
	const releases: string[] = [];
	let screenshots = 0;
	let visible = false;
	const controller = new ModifierController({
		isVisible: () => visible,
		getTriggerModifier: () => "ALT",
		onRelease: (source) => releases.push(source),
		onScreenshot: () => {
			screenshots += 1;
		},
	});
	const widget = new Gtk.Box();
	controller.attach(widget);
	const keyController = widget.observe_controllers().get_item(0) as Gtk.EventControllerKey;
	keyController.emit("key-released", 65513, 0, 0);
	keyController.emit("key-released", 65377, 0, 0);
	controller.start();
	await delay(40);
	visible = true;
	controller.start();
	await delay(40);
	controller.stop();
	controller.stop();
	assert(releases.includes("watch"), "released modifier was not detected");
	assert(releases.includes("key"), "released modifier key was not detected");
	assert(screenshots === 1, "screenshot key was not detected");
	for (const modifier of ["SUPER", "ALT", "CTRL", "CONTROL", "SHIFT", "other"])
		modifierMaskFor(modifier);
});

test("Window repository reads, caches, sorts, and updates focus history", async () => {
	const repository = new WindowRepository();
	const alphabetical = await repository.getWindows(SortMode.ALPHABETICAL);
	const cached = await repository.getWindows(SortMode.ALPHABETICAL);
	assert(cached === alphabetical, "window cache was not reused");
	const active = await repository.getActiveAddress();
	const cachedActive = await repository.getActiveAddress();
	assert(cachedActive === active, "active window cache was not reused");
	if (alphabetical[0]) repository.updateFocusHistory(alphabetical[0].address);
	repository.updateFocusHistory("");
	const recent = await repository.getWindows(SortMode.RECENCY);
	assert(Array.isArray(recent), "recency query did not return windows");
});

test("Window Switcher controller completes a real lifecycle", async () => {
	let disposeRoot = () => {};
	const controller = new RealWindowSwitcherController();
	createRoot((dispose) => {
		disposeRoot = dispose;
		controller.init();
	});
	try {
		assert(controller.setMode("missing").startsWith("invalid"), "invalid mode passed");
		assert(controller.setMode("icons") === "mode set to ICONS", "mode failed");
		controller.toggleMode();
		assert(
			(await controller.setSortMode("missing")).startsWith("invalid"),
			"invalid sort mode passed",
		);
		await controller.show();
		await controller.setSortMode("alphabetical");
		controller.hide();
		await controller.next("ALT");
		controller.hide();
		await controller.prev("ALT");
		controller.hide();
		controller.commit();
		controller.select(0);
	} finally {
		controller.teardown();
		disposeRoot();
	}
});

test("Window Switcher ignores a hidden lifecycle and activates the latest show", async () => {
	const firstWindows = deferred<WindowInfo[]>();
	const secondWindows = deferred<WindowInfo[]>();
	let query = 0;
	const controller = new RealWindowSwitcherController({
		repository: {
			getWindows: () => (query++ === 0 ? firstWindows.promise : secondWindows.promise),
			getActiveAddress: async () => windows[1].address,
			updateFocusHistory: () => {},
		},
	});
	let disposeRoot = () => {};
	createRoot((dispose) => {
		disposeRoot = dispose;
		controller.init();
	});
	try {
		const staleShow = controller.show();
		controller.hide();
		firstWindows.resolve(windows);
		await staleShow;
		assert(controller.isVisible() === false, "hidden show result became visible");

		const latestShow = controller.show();
		const latestWindows = windows.slice().reverse();
		secondWindows.resolve(latestWindows);
		await latestShow;
		assert(controller.isVisible(), "latest show did not become visible");
		assert(
			controller.session.windows === latestWindows,
			"latest show did not own the session",
		);
	} finally {
		controller.teardown();
		disposeRoot();
	}
});

test("Window Switcher ignores active-window results after teardown", async () => {
	const activeAddress = deferred<string | null>();
	const controller = new RealWindowSwitcherController({
		repository: {
			getWindows: async () => windows,
			getActiveAddress: () => activeAddress.promise,
			updateFocusHistory: () => {},
		},
	});
	let disposeRoot = () => {};
	createRoot((dispose) => {
		disposeRoot = dispose;
		controller.init();
	});
	try {
		const pendingShow = controller.show();
		await Promise.resolve();
		controller.teardown();
		activeAddress.resolve(windows[0].address);
		await pendingShow;
		assert(controller.isVisible() === false, "teardown result became visible");
	} finally {
		controller.teardown();
		disposeRoot();
	}
});

test("Window Switcher ignores an older overlapping sort refresh", async () => {
	const olderRefresh = deferred<WindowInfo[]>();
	const latestRefresh = deferred<WindowInfo[]>();
	let query = 0;
	const controller = new RealWindowSwitcherController({
		repository: {
			getWindows: () => {
				query += 1;
				if (query === 1) return Promise.resolve(windows);
				return query === 2 ? olderRefresh.promise : latestRefresh.promise;
			},
			getActiveAddress: async () => windows[0].address,
			updateFocusHistory: () => {},
		},
	});
	let disposeRoot = () => {};
	createRoot((dispose) => {
		disposeRoot = dispose;
		controller.init();
	});
	try {
		await controller.show();
		const olderRequest = controller.setSortMode("alphabetical");
		const latestRequest = controller.setSortMode("recency");
		const latestWindows = [windows[1], windows[2], windows[0]];

		latestRefresh.resolve(latestWindows);
		await latestRequest;
		olderRefresh.resolve(windows.slice().reverse());
		await olderRequest;

		assert(
			controller.session.windows === latestWindows,
			"older sort refresh replaced the latest result",
		);
	} finally {
		controller.teardown();
		disposeRoot();
	}
});

test("Window Switcher preserves a newer cycle over a pending sort refresh", async () => {
	const refresh = deferred<WindowInfo[]>();
	let query = 0;
	const controller = new RealWindowSwitcherController({
		repository: {
			getWindows: () => (query++ === 0 ? Promise.resolve(windows) : refresh.promise),
			getActiveAddress: async () => windows[0].address,
			updateFocusHistory: () => {},
		},
	});
	let disposeRoot = () => {};
	createRoot((dispose) => {
		disposeRoot = dispose;
		controller.init();
	});
	try {
		await controller.show();
		const pendingRefresh = controller.setSortMode("alphabetical");
		await controller.next();
		refresh.resolve(windows.slice().reverse());
		await pendingRefresh;

		assert(controller.session.windows === windows, "stale refresh replaced windows");
		assert(controller.session.currentIndex === 1, "stale refresh reset selection");
	} finally {
		controller.teardown();
		disposeRoot();
	}
});

test("Window Switcher preserves a newer selection over a pending sort refresh", async () => {
	const refresh = deferred<WindowInfo[]>();
	let query = 0;
	const controller = new RealWindowSwitcherController({
		repository: {
			getWindows: () => (query++ === 0 ? Promise.resolve(windows) : refresh.promise),
			getActiveAddress: async () => windows[0].address,
			updateFocusHistory: () => {},
		},
	});
	let disposeRoot = () => {};
	createRoot((dispose) => {
		disposeRoot = dispose;
		controller.init();
	});
	try {
		await controller.show();
		const pendingRefresh = controller.setSortMode("alphabetical");
		controller.select(2);
		refresh.resolve(windows.slice().reverse());
		await pendingRefresh;

		assert(controller.session.windows === windows, "stale refresh replaced windows");
		assert(controller.session.currentIndex === 2, "stale refresh reset selection");
	} finally {
		controller.teardown();
		disposeRoot();
	}
});

test("Window Switcher ignores a hidden cycle after cancellation", async () => {
	const activeAddress = deferred<string | null>();
	const controller = new RealWindowSwitcherController({
		repository: {
			getWindows: async () => windows,
			getActiveAddress: () => activeAddress.promise,
			updateFocusHistory: () => {},
		},
	});
	let disposeRoot = () => {};
	createRoot((dispose) => {
		disposeRoot = dispose;
		controller.init();
	});
	try {
		const pendingCycle = controller.next();
		await Promise.resolve();
		controller.hide();
		activeAddress.resolve(windows[0].address);
		await pendingCycle;

		assert(controller.isVisible() === false, "cancelled cycle became visible");
		assert(controller.session.windows.length === 0, "cancelled cycle created a session");
	} finally {
		controller.teardown();
		disposeRoot();
	}
});

function request(
	handler: (argv: string[], respond: (response: string) => void) => void,
	argv: string[],
): Promise<string> {
	return new Promise((resolve) => handler(argv, resolve));
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
			resolve();
			return GLib.SOURCE_REMOVE;
		});
	});
}

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
} {
	let resolve = (_value: T) => {};
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

function collectButtons(widget: Gtk.Widget): Gtk.Button[] {
	const buttons: Gtk.Button[] = [];
	if (widget instanceof Gtk.Button) buttons.push(widget);
	let child = widget.get_first_child();
	while (child) {
		buttons.push(...collectButtons(child));
		child = child.get_next_sibling();
	}
	return buttons;
}

function findWidgetWithClass(widget: Gtk.Widget, className: string): Gtk.Widget | null {
	if (widget.has_css_class(className)) return widget;
	let child = widget.get_first_child();
	while (child) {
		const match = findWidgetWithClass(child, className);
		if (match) return match;
		child = child.get_next_sibling();
	}
	return null;
}
