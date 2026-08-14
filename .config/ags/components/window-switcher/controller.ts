import app from "ags/gtk4/app";
import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import { createActor, type ActorRefFrom } from "xstate";
import {
	getProfileState,
	subscribeProfileState,
} from "../../services/profile-state";
import { debugLog, writeBindDiagnostic } from "./diagnostics";
import { windowSwitcherMachine, type WindowInfo } from "./machine";
import { ModifierController, modifierMaskFor } from "./modifier-controller";
import { PreviewCache } from "./preview-cache";
import {
	getInitialSelection,
	resolveCommitTarget,
	type SwitchDirection,
} from "./session-policy";
import { applyStaticCss, DisplayMode } from "./styles";
import { focusWindow, restoreMinimizedAndFocus } from "./window-actions";
import { WindowRepository, SortMode } from "./window-repository";
import { WindowSwitcherView } from "./window-switcher-view";

type WindowSwitcherActor = ActorRefFrom<typeof windowSwitcherMachine>;

export class WindowSwitcherController {
	#actor: WindowSwitcherActor | null = null;
	#displayMode = DisplayMode.PREVIEWS;
	#sortMode = SortMode.RECENCY;
	#unsubscribeProfile: (() => void) | null = null;
	#shutdownConnected = false;
	#repository = new WindowRepository();
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

	init(): void {
		this.#actor ??= createActor(windowSwitcherMachine).start();
		this.#syncProfilePresentation();
		this.#unsubscribeProfile ??= subscribeProfileState(() =>
			this.#syncProfilePresentation(),
		);
		if (this.#shutdownConnected === false) {
			this.#shutdownConnected = true;
			app.connect("shutdown", () => this.teardown());
		}
		applyStaticCss(this.#displayMode);
		this.#modifiers.attach(this.#view.create());
	}

	teardown(): void {
		this.#modifiers.stop();
		this.#unsubscribeProfile?.();
		this.#unsubscribeProfile = null;
		this.#previews.dispose();
		this.#actor?.stop();
		this.#actor = null;
		this.#view.dispose();
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
		this.#previews.startMonitoring();
		const windows = await this.#repository.getWindows(this.#sortMode);
		if (windows.length <= 1) return;
		const activeAddress = await this.#repository.getActiveAddress();
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
		applyStaticCss(this.#displayMode);
		this.#rebuildIfVisible();
		return `mode set to ${normalized}`;
	}

	toggleMode(): void {
		this.#displayMode =
			this.#displayMode === DisplayMode.ICONS
				? DisplayMode.PREVIEWS
				: DisplayMode.ICONS;
		applyStaticCss(this.#displayMode);
		this.#rebuildIfVisible();
	}

	async setSortMode(mode: string | undefined): Promise<string> {
		const normalized = mode?.toUpperCase();
		if (normalized !== "ALPHABETICAL" && normalized !== "RECENCY")
			return "invalid sort mode, use 'alphabetical' or 'recency'";
		this.#sortMode =
			normalized === "ALPHABETICAL" ? SortMode.ALPHABETICAL : SortMode.RECENCY;
		if (this.isVisible()) {
			this.actor.send({
				type: "REFRESH",
				windows: await this.#repository.getWindows(this.#sortMode),
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
			this.actor.send({ type: "CYCLE", direction });
			this.#view.render(this.session, this.#displayMode);
			return;
		}
		const windows = await this.#repository.getWindows(this.#sortMode);
		if (windows.length <= 1) return;
		const activeAddress = await this.#repository.getActiveAddress();
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
		applyStaticCss(this.#displayMode);
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
