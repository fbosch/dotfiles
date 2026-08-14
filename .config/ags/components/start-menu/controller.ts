import app from "ags/gtk4/app";
import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import { createActor, type ActorRefFrom } from "xstate";
import { getFallbackLetter } from "../../services/app-icons";
import { perf } from "../../services/performance-monitor";
import {
	getProfileState,
	subscribeProfileState,
	type ProfileSelection,
	type ProfileState,
} from "../../services/profile-state";
import {
	clearRecentApplicationFocusHistory,
	getRecentApplications,
	launchRecentApplication,
	startRecentApplicationFocusHistory,
} from "../../services/recent-applications";
import {
	clearRecentDocuments,
	getRecentDocuments,
	openRecentDocument,
	type RecentDocument,
} from "../../services/recent-documents";
import { openUtility } from "../../services/utility-manager";
import { dispatchStartMenuAction } from "./actions";
import {
	createMenuCommands,
	runMenuCommand,
	sessionActionIds,
} from "./menu-commands";
import { startMenuMachine } from "./machine";
import type { RecentItemsMenuModel } from "./recent-items-menu";
import { StartMenuView } from "./start-menu-view";
import { applyStartMenuStyles } from "./styles";
import { UpdatesCache } from "./updates-cache";
import type { UpdatesSnapshot } from "./updates-policy";

type StartMenuActor = ActorRefFrom<typeof startMenuMachine>;

const emptyUpdates: UpdatesSnapshot = { flake: null, flatpak: null };

export class StartMenuController {
	#actor: StartMenuActor | null = null;
	#actorSubscription: { unsubscribe: () => void } | null = null;
	#shutdownConnected = false;
	#unsubscribeProfile: (() => void) | null = null;
	#stopRecentFocusHistory: (() => void) | null = null;
	#profileState: ProfileState | null = getProfileState();
	#recentDocuments: RecentDocument[] = [];
	#updates: UpdatesSnapshot = emptyUpdates;
	#cache = new UpdatesCache();
	#commands = createMenuCommands();
	#view = new StartMenuView({
		getModel: () => ({
			profileState: this.#profileState,
			updates: this.#updates,
		}),
		getRecentItems: () => this.#recentItemsModel(),
		onMenuAction: (itemId) => this.#executeMenuAction(itemId),
		onProfileSelect: (selection) => this.#selectProfile(selection),
		onHide: () => this.hide(),
		onRecentOpenRequest: () =>
			this.#actor?.send({ type: "RECENT_OPEN_REQUEST" }),
		onRecentCloseRequest: () =>
			this.#actor?.send({ type: "RECENT_CLOSE_REQUEST" }),
		onRecentOpenNow: () => this.#actor?.send({ type: "RECENT_OPEN_NOW" }),
		onRecentCloseNow: () => this.#actor?.send({ type: "RECENT_CLOSE_NOW" }),
		onRecentApplication: (id) => {
			launchRecentApplication(id);
			this.hide();
		},
		onRecentDocument: (uri) => {
			openRecentDocument(uri);
			this.hide();
		},
		onClearRecentItems: () => {
			clearRecentApplicationFocusHistory();
			if (clearRecentDocuments()) this.#recentDocuments = [];
			this.#view.renderRecentItems();
		},
		isMenuVisible: () => this.isVisible(),
		isRecentItemsVisible: () => this.#recentItemsAreVisible(),
	});

	init(): void {
		if (this.#actor === null) {
			this.#actor = createActor(startMenuMachine);
			this.#actorSubscription = this.#actor.subscribe((snapshot) => {
				const visible = snapshot.hasTag("recent-items-visible");
				if (visible && this.#view.recentItemsRendered === false) {
					this.#view.renderRecentItems();
					return;
				}
				if (visible === false && this.#view.recentItemsRendered)
					this.#view.concealRecentItems();
			});
			this.#actor.start();
		}
		if (this.#shutdownConnected === false) {
			this.#shutdownConnected = true;
			app.connect("shutdown", () => this.teardown());
		}
		applyStartMenuStyles();
		this.#stopRecentFocusHistory ??= startRecentApplicationFocusHistory();
		this.#generateAvatar();
		this.#cache.start(() => this.#refreshCacheData());
		this.#startProfileSubscription();
		this.#refreshCacheData();
	}

	teardown(): void {
		this.#unsubscribeProfile?.();
		this.#unsubscribeProfile = null;
		this.#cache.dispose();
		this.#stopRecentFocusHistory?.();
		this.#stopRecentFocusHistory = null;
		this.#actorSubscription?.unsubscribe();
		this.#actorSubscription = null;
		this.#actor?.stop();
		this.#actor = null;
		this.#view.dispose();
	}

	isVisible(): boolean {
		return this.#actor?.getSnapshot().hasTag("menu-visible") === true;
	}

	show(): void {
		const mark = perf.start("start-menu", "showMenu");
		let ok = true;
		let error: string | undefined;
		try {
			this.#refreshCacheData(false);
			this.#recentDocuments = getRecentDocuments();
			if (this.#view.isCreated) this.#view.render();
			else this.#view.create();
			this.#view.show();
			this.#showWaybar();
			this.actor.send({ type: "SHOW" });
		} catch (cause) {
			ok = false;
			error = String(cause);
			throw cause;
		} finally {
			mark.end(ok, error);
		}
	}

	hide(): void {
		this.#actor?.send({ type: "HIDE" });
		this.#view.hide();
	}

	toggle(): string {
		if (this.isVisible()) {
			this.hide();
			return "hidden";
		}
		this.show();
		return "shown";
	}

	refresh(): void {
		const reopenRecentItems = this.#recentItemsAreVisible();
		this.#refreshCacheData(false);
		this.#recentDocuments = getRecentDocuments();
		if (this.#view.isCreated) this.#view.render();
		if (reopenRecentItems) this.#actor?.send({ type: "RECENT_OPEN_NOW" });
	}

	get actor(): StartMenuActor {
		if (!this.#actor) throw new Error("Start Menu has not been initialized");
		return this.#actor;
	}

	#recentItemsAreVisible(): boolean {
		return this.#actor?.getSnapshot().hasTag("recent-items-visible") === true;
	}

	#recentItemsModel(): RecentItemsMenuModel {
		const display = Gdk.Display.get_default();
		const iconTheme = display ? Gtk.IconTheme.get_for_display(display) : null;
		return {
			applications: getRecentApplications(8, iconTheme).map((application) => ({
				id: application.desktopId,
				label: application.name,
				icon: application.icon,
				fallbackLetter: getFallbackLetter({ class: application.name }),
			})),
			documents: this.#recentDocuments.map((document) => ({
				id: document.uri,
				label: document.name,
				detail: document.detail,
				icon: document.icon,
				fallbackLetter: getFallbackLetter({ class: document.name }),
			})),
		};
	}

	#executeMenuAction(itemId: string): void {
		dispatchStartMenuAction(itemId, {
			commands: this.#commands,
			sessionActionIds,
			hideMenu: () => this.hide(),
			showRecentItemsMenu: () =>
				this.#actor?.send({ type: "RECENT_OPEN_NOW" }),
			openUtility,
			runCommand: runMenuCommand,
			reportMissingCommand: (id) => console.error(`No command found for ${id}`),
			reportCommandError: (id, error) =>
				console.error(`Failed to execute command for ${id}:`, error),
		});
	}

	#refreshCacheData(updateVisibleMenu = true): void {
		this.#updates = this.#cache.load();
		if (updateVisibleMenu && this.#view.isCreated) this.#view.render();
	}

	#startProfileSubscription(): void {
		if (this.#unsubscribeProfile !== null) return;
		this.#profileState = getProfileState();
		this.#unsubscribeProfile = subscribeProfileState((state) => {
			this.#profileState = state;
			this.#view.updateProfile(state);
		});
	}

	#selectProfile(selection: ProfileSelection): void {
		const profilectl = `${GLib.get_home_dir()}/.config/hypr/runtime/profiles/profilectl.sh`;
		const command =
			selection === "auto"
				? `${profilectl} clear-manual`
				: `${profilectl} set-manual ${selection}`;
		try {
			GLib.spawn_command_line_async(command);
		} catch (error) {
			console.error("Failed to update profile:", error);
		}
	}

	#showWaybar(): void {
		try {
			GLib.spawn_command_line_async("pkill -SIGUSR1 -f '(^|/)waybar( |$)'");
		} catch (error) {
			console.error("Failed to show waybar:", error);
		}
	}

	#generateAvatar(): void {
		const path = `${GLib.get_home_dir()}/.config/ags/scripts/generate-circular-avatar.sh`;
		if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return;
		try {
			GLib.spawn_command_line_async(path);
		} catch (error) {
			console.error("Failed to generate circular avatar:", error);
		}
	}
}
