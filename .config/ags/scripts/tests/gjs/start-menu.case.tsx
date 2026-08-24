import { createRoot } from "ags";
import app from "ags/gtk4/app";
import Gtk from "gi://Gtk?version=4.0";
import type { ProfileState } from "@/services/profile-state";
import { StartMenuController } from "@/components/start-menu/controller";
import { ProfileControls } from "@/components/start-menu/profile-controls";
import { createRecentItemsMenu } from "@/components/start-menu/recent-items-menu";
import { createRequestHandler } from "@/components/start-menu/request-handler";
import { StartMenuView } from "@/components/start-menu/start-menu-view";
import { UpdatesCache } from "@/components/start-menu/updates-cache";
import { createUserProfile } from "@/components/start-menu/user-profile";
import { assert, test } from "./harness";

const profileState: ProfileState = {
	generation: 1,
	selection: "auto",
	resolved: "gaming",
	sources: { gaming: { game: 1 }, powersave: {} },
};

test("Start Menu handles its complete request lifecycle", () => {
	const controller = new StartMenuController();
	const handleRequest = createRequestHandler(controller);
	controller.init();

	try {
		assert(request(handleRequest, []) === "ready", "empty request was not ready");
		assert(
			request(handleRequest, ["not-json"]) === "error: invalid JSON",
			"invalid JSON was accepted",
		);
		assert(
			request(handleRequest, [JSON.stringify({ action: "missing" })]) ===
				"unknown action",
			"unknown action was accepted",
		);
		assert(
			request(handleRequest, [JSON.stringify({ action: "is-visible" })]) ===
				"false",
			"menu started visible",
		);
		assert(
			request(handleRequest, [
				JSON.stringify({
					action: "prepare",
					source: "waybar:startbutton",
					sequence: 1,
				}),
			]) === "prepared",
			"prepare request failed",
		);
		assert(
			Boolean(app.get_window("start-menu")),
			"prepare did not create the hidden menu view",
		);
		assert(controller.isVisible() === false, "prepare showed the menu");
		assert(
			request(handleRequest, [
				JSON.stringify({
					action: "release",
					source: "waybar:startbutton",
					sequence: 2,
				}),
			]) === "released",
			"release request failed",
		);
		assert(
			request(handleRequest, [JSON.stringify({ action: "show" })]) === "shown",
			"show request failed",
		);
		assert(controller.isVisible(), "show did not update machine state");
		assert(
			request(handleRequest, [JSON.stringify({ action: "refresh" })]) ===
				"refreshed",
			"refresh request failed",
		);
		assert(
			request(handleRequest, [JSON.stringify({ action: "toggle" })]) ===
				"hidden",
			"visible toggle did not hide",
		);
		assert(
			request(handleRequest, [JSON.stringify({ action: "toggle" })]) ===
				"shown",
			"hidden toggle did not show",
		);
		assert(
			request(handleRequest, [JSON.stringify({ action: "hide" })]) === "hidden",
			"hide request failed",
		);
	} finally {
		controller.teardown();
	}
});

test("Start Menu view renders profile, updates, and recent items", () => {
	const calls: string[] = [];
	const view = new StartMenuView({
		getModel: () => ({
			profileState,
			updates: {
				flake: {
					count: 1,
					updates: [
						{
							name: "nixpkgs",
							currentRev: "old",
							currentShort: "abc",
							newRev: "new",
							newShort: "def",
						},
					],
					timestamp: new Date().toISOString(),
				},
				flatpak: {
					count: 1,
					updates: [],
					timestamp: new Date().toISOString(),
				},
			},
		}),
		getRecentItems: () => ({
			applications: [
				{ id: "app", label: "App", icon: null, fallbackLetter: "A" },
			],
			documents: [
				{
					id: "file:///doc",
					label: "Doc",
					detail: "Today",
					icon: null,
					fallbackLetter: "D",
				},
			],
		}),
		onMenuAction: (id) => calls.push(`menu:${id}`),
		onMenuIntentStart: (id, source) =>
			calls.push(`intent-start:${id}:${source}`),
		onMenuIntentEnd: (id, source) => calls.push(`intent-end:${id}:${source}`),
		onProfileSelect: (selection) => calls.push(`profile:${selection}`),
		onHide: () => calls.push("hide"),
		onRecentOpenRequest: () => calls.push("recent-open-request"),
		onRecentCloseRequest: () => calls.push("recent-close-request"),
		onRecentOpenNow: () => calls.push("recent-open"),
		onRecentCloseNow: () => calls.push("recent-close"),
		onRecentApplication: (id) => calls.push(`app:${id}`),
		onRecentDocument: (id) => calls.push(`document:${id}`),
		onClearRecentItems: () => calls.push("clear"),
		isMenuVisible: () => true,
		isRecentItemsVisible: () => true,
	});

	view.create();
	assert(view.isCreated, "view was not created");
	const startMenu = app.get_window("start-menu");
	const aboutButton = startMenu
		? collectButtons(startMenu).find((button) => hasLabel(button, "About This PC"))
		: null;
	assert(Boolean(aboutButton), "About This PC button was not rendered");
	const controllers = aboutButton?.observe_controllers();
	let motionController: Gtk.EventControllerMotion | null = null;
	let focusController: Gtk.EventControllerFocus | null = null;
	for (let index = 0; index < (controllers?.get_n_items() ?? 0); index++) {
		const controller = controllers?.get_item(index);
		if (controller instanceof Gtk.EventControllerMotion)
			motionController = controller;
		if (controller instanceof Gtk.EventControllerFocus) focusController = controller;
	}
	assert(Boolean(motionController), "About This PC has no hover controller");
	assert(Boolean(focusController), "About This PC has no focus controller");
	const intentStart = calls.length;
	motionController?.emit("enter", 0, 0);
	focusController?.emit("enter");
	motionController?.emit("leave");
	focusController?.emit("leave");
	assert(
		JSON.stringify(calls.slice(intentStart)) ===
			JSON.stringify([
				"intent-start:about-this-pc:pointer",
				"intent-start:about-this-pc:focus",
				"intent-end:about-this-pc:pointer",
				"intent-end:about-this-pc:focus",
			]),
		"About This PC hover and focus intent was imbalanced",
	);
	view.updateProfile(profileState);
	view.updateUpdates({ flake: null, flatpak: null });
	view.updateUpdates({
		flake: null,
		flatpak: {
			count: 2,
			updates: [],
			timestamp: new Date().toISOString(),
		},
	});
	view.renderRecentItems();
	assert(view.recentItemsRendered, "recent items were not rendered");
	view.concealRecentItems();
	assert(view.recentItemsRendered === false, "recent items stayed visible");
	view.hide();
	view.dispose();
	assert(view.isCreated === false, "view was not disposed");
});

test("Start Menu GTK child surfaces activate every action", () => {
	createRoot((dispose) => {
		const calls: string[] = [];
		const profiles = new ProfileControls({
			onSelect: (selection) => calls.push(`profile:${selection}`),
			onButtonCreated: () => {},
		});
		const profileWidget = profiles.create(profileState);
		profiles.update({ ...profileState, selection: "default", resolved: "default" });
		profiles.update(null);
		for (const button of collectButtons(profileWidget)) button.emit("clicked");

		const recentWidget = createRecentItemsMenu(
			{
				applications: [
					{ id: "app", label: "App", icon: null, fallbackLetter: "A" },
				],
				documents: [
					{
						id: "doc",
						label: "Doc",
						detail: "Detail",
						icon: null,
						fallbackLetter: "D",
					},
				],
			},
			{
				onApplicationActivated: ({ id }) => calls.push(`app:${id}`),
				onDocumentActivated: ({ id }) => calls.push(`document:${id}`),
				onClearRecentItems: () => calls.push("clear"),
			},
		);
		for (const button of collectButtons(recentWidget)) button.emit("clicked");
		createRecentItemsMenu({ applications: [], documents: [] });
		createUserProfile();

		assert(calls.includes("profile:auto"), "profile action was not activated");
		assert(calls.includes("app:app"), "recent application was not activated");
		assert(calls.includes("document:doc"), "recent document was not activated");
		assert(calls.includes("clear"), "clear action was not activated");
		dispose();
	});
});

test("Start Menu update cache starts and disposes safely", () => {
	const cache = new UpdatesCache();
	cache.load();
	cache.start(() => {});
	cache.start(() => {});
	cache.dispose();
	cache.dispose();
});

function request(
	handler: (argv: string[], respond: (response: string) => void) => void,
	argv: string[],
): string {
	let response = "";
	handler(argv, (value) => {
		response = value;
	});
	return response;
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

function hasLabel(widget: Gtk.Widget, label: string): boolean {
	if (widget instanceof Gtk.Label && widget.get_label() === label) return true;
	let child = widget.get_first_child();
	while (child) {
		if (hasLabel(child, label)) return true;
		child = child.get_next_sibling();
	}
	return false;
}
