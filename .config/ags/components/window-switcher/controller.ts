import app from "ags/gtk4/app";
import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import { createActor, type ActorRefFrom } from "xstate";
import {
	getProfileState,
	subscribeProfileState,
} from "@/services/profile-state";
import { debugLog, writeBindDiagnostic } from "./diagnostics";
import { windowSwitcherMachine, type WindowInfo } from "./machine";
import { ModifierController, modifierMaskFor } from "./modifier-controller";
import { PreviewCache } from "./preview-cache";
import {
	getInitialSelection,
	resolveCommitTarget,
	type SwitchDirection,
} from "./session-policy";
import { DisplayMode } from "./styles";
import { focusWindow, restoreMinimizedAndFocus } from "./window-actions";
import { WindowRepository, SortMode } from "./window-repository";
import { WindowSwitcherView } from "./window-switcher-view";

type WindowSwitcherActor = ActorRefFrom<typeof windowSwitcherMachine>;
type WindowRepositoryPort = Pick<
	WindowRepository,
	"getWindows" | "getActiveAddress" | "updateFocusHistory"
>;

interface WindowSwitcherControllerOptions {
	repository?: WindowRepositoryPort;
}

export class WindowSwitcherController {
	#actor: WindowSwitcherActor | null = null;
	#displayMode = DisplayMode.PREVIEWS;
	#sortMode = SortMode.RECENCY;
	#unsubscribeProfile: (() => void) | null = null;
	#shutdownSignalId = 0;
	#requestGeneration = 0;
	#viewAttached = false;
	readonly #repository: WindowRepositoryPort;
	#previews = new PreviewCache(() => {
		if (this.isVisible() && this.#displayMode === DisplayMode.PREVIEWS)
			this.#view.refreshPreviews(this.session.windows);
	});
	#view = new WindowSwitcherView(this.#previews, {
		onSelect: (index) => this.select(index),
		onCommit: () => this.commit(),
	});
	#modifiers = new ModifierController({
		isVisible: () => this.isVisible(),
		getTriggerModifier: () => this.session.triggerModifier,
		onRelease: (source) => this.#commitFromModifierRelease(source),
		onScreenshot: () => this.#takeScreenshot(),
	});

	constructor(options: WindowSwitcherControllerOptions = {}) {
		this.#repository = options.repository ?? new WindowRepository();
	}

	init(): void {
		this.#actor ??= createActor(windowSwitcherMachine).start();
		this.#syncProfilePresentation();
		this.#unsubscribeProfile ??= subscribeProfileState(() =>
			this.#syncProfilePresentation(),
		);
		if (this.#shutdownSignalId === 0)
			this.#shutdownSignalId = app.connect("shutdown", () => this.teardown());
	}

	teardown(): void {
		this.#requestGeneration += 1;
		this.#modifiers.stop();
		this.#unsubscribeProfile?.();
		this.#unsubscribeProfile = null;
		this.#previews.dispose();
		this.#actor?.stop();
		this.#actor = null;
		this.#view.dispose();
		this.#viewAttached = false;
		if (this.#shutdownSignalId !== 0) {
			app.disconnect(this.#shutdownSignalId);
			this.#shutdownSignalId = 0;
		}
	}

	isVisible(): boolean {
		return this.#actor?.getSnapshot().hasTag("switcher-visible") === true;
	}
	get displayMode(): DisplayMode {
		return this.#displayMode;
	}
	get sortMode(): SortMode {
		return this.#sortMode;
	}

	async show(): Promise<void> {
		const generation = ++this.#requestGeneration;
		this.#previews.startMonitoring();
		const windows = await this.#repository.getWindows(this.#sortMode);
		if (generation !== this.#requestGeneration) return;
		if (windows.length <= 1) return;
		const activeAddress = await this.#repository.getActiveAddress();
		if (generation !== this.#requestGeneration) return;
		this.#activate(
			windows,
			Math.max(
				0,
				windows.findIndex((window) => window.address === activeAddress),
			),
			"ALT",
		);
	}

	async next(triggerModifier = "ALT"): Promise<void> {
		await this.#cycle("next", triggerModifier);
	}
	async prev(triggerModifier = "ALT"): Promise<void> {
		await this.#cycle("previous", triggerModifier);
	}

	commit(): void {
		if (this.isVisible() === false) {
			this.#hide("COMMIT");
			return;
		}
		const { windows, currentIndex } = this.session;
		const target = resolveCommitTarget(windows, currentIndex);
		if (!target) {
			this.#hide("COMMIT");
			return;
		}
		try {
			if (target.restoreMinimized) restoreMinimizedAndFocus(target.address);
			else focusWindow(windows[currentIndex]);
			this.#repository.updateFocusHistory(windows[currentIndex].address);
		} catch (error) {
			console.error("Error focusing window:", error);
		}
		this.#hide("COMMIT");
	}

	hide(): void {
		this.#hide("HIDE");
	}

	setMode(mode: string | undefined): string {
		const normalized = mode?.toUpperCase();
		if (normalized !== "ICONS" && normalized !== "PREVIEWS")
			return "invalid mode, use 'icons' or 'previews'";
		this.#displayMode =
			normalized === "ICONS" ? DisplayMode.ICONS : DisplayMode.PREVIEWS;
		this.#rebuildIfVisible();
		return `mode set to ${normalized}`;
	}

	toggleMode(): void {
		this.#displayMode =
			this.#displayMode === DisplayMode.ICONS
				? DisplayMode.PREVIEWS
				: DisplayMode.ICONS;
		this.#rebuildIfVisible();
	}

	async setSortMode(mode: string | undefined): Promise<string> {
		const normalized = mode?.toUpperCase();
		if (normalized !== "ALPHABETICAL" && normalized !== "RECENCY")
			return "invalid sort mode, use 'alphabetical' or 'recency'";
		this.#sortMode =
			normalized === "ALPHABETICAL" ? SortMode.ALPHABETICAL : SortMode.RECENCY;
		const generation = ++this.#requestGeneration;
		if (this.isVisible()) {
			const windows = await this.#repository.getWindows(this.#sortMode);
			if (
				generation !== this.#requestGeneration ||
				this.isVisible() === false
			)
				return `sort mode set to ${normalized}`;
			this.actor.send({
				type: "REFRESH",
				windows,
			});
			if (this.isVisible() === false) this.#hide("HIDE");
			else {
				this.#view.reset();
				this.#view.render(this.session, this.#displayMode);
			}
		}
		return `sort mode set to ${normalized}`;
	}

	select(index: number): void {
		this.#requestGeneration += 1;
		this.actor.send({ type: "SELECT", index });
	}

	get session() {
		return this.actor.getSnapshot().context;
	}
	get actor(): WindowSwitcherActor {
		if (!this.#actor)
			throw new Error("Window Switcher actor has not been initialized");
		return this.#actor;
	}

	async #cycle(
		direction: SwitchDirection,
		triggerModifier: string,
	): Promise<void> {
		if (this.isVisible()) {
			if (this.session.windows.length <= 1) return;
			this.#requestGeneration += 1;
			this.actor.send({ type: "CYCLE", direction });
			this.#view.render(this.session, this.#displayMode);
			return;
		}
		const generation = ++this.#requestGeneration;
		const windows = await this.#repository.getWindows(this.#sortMode);
		if (generation !== this.#requestGeneration) return;
		if (windows.length <= 1) return;
		const activeAddress = await this.#repository.getActiveAddress();
		if (generation !== this.#requestGeneration) return;
		if (activeAddress) this.#repository.updateFocusHistory(activeAddress);
		this.#activate(
			windows,
			getInitialSelection(windows, activeAddress, this.#sortMode, direction),
			triggerModifier,
		);
	}

	#activate(
		windows: WindowInfo[],
		index: number,
		triggerModifier: string,
	): void {
		if (this.#viewAttached === false) {
			this.#modifiers.attach(this.#view.create());
			this.#viewAttached = true;
		}
		writeBindDiagnostic(
			`enter active modifier=${triggerModifier} pressed=${this.#isModifierPressed(triggerModifier)}`,
		);
		debugLog(
			`[State] IDLE -> ACTIVE (${windows.length} windows, index ${index})`,
		);
		this.actor.send({ type: "ACTIVATE", windows, index, triggerModifier });
		this.#view.render(this.session, this.#displayMode);
		this.#view.show();
		this.#modifiers.start();
	}

	#hide(event: "COMMIT" | "HIDE"): void {
		this.#requestGeneration += 1;
		debugLog(`[State] ${this.isVisible() ? "ACTIVE" : "IDLE"} -> IDLE`);
		this.#modifiers.stop();
		this.actor.send({ type: event });
		this.#view.hide();
	}

	#rebuildIfVisible(): void {
		if (this.isVisible()) {
			this.#view.reset();
			this.#view.render(this.session, this.#displayMode);
		}
	}
	#syncProfilePresentation(): void {
		const next =
			getProfileState()?.resolved !== "default"
				? DisplayMode.ICONS
				: DisplayMode.PREVIEWS;
		if (next === this.#displayMode) return;
		this.#displayMode = next;
		this.#rebuildIfVisible();
	}
	#commitFromModifierRelease(source: "key" | "watch"): void {
		if (this.isVisible() === false) return;
		if (source === "watch") {
			writeBindDiagnostic(
				`watch released modifier=${this.session.triggerModifier}`,
			);
			debugLog(`${this.session.triggerModifier} released, committing switch`);
		} else
			debugLog(
				`${this.session.triggerModifier} key released, committing switch`,
			);
		this.commit();
	}
	#takeScreenshot(): void {
		try {
			GLib.spawn_command_line_async(
				"bash ~/.config/hypr/runtime/capture/screenshot.sh screen",
			);
			debugLog("Screenshot triggered from window-switcher");
		} catch (error) {
			console.error("Failed to trigger screenshot:", error);
		}
	}
	#isModifierPressed(name: string): boolean {
		const keyboard = Gdk.Display.get_default()
			?.get_default_seat()
			?.get_keyboard();
		const mask = modifierMaskFor(name);
		return keyboard ? (keyboard.get_modifier_state() & mask) !== 0 : false;
	}
}
