import app from "ags/gtk4/app";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { createPreparationIntentClaims } from "@/services/preparation-intent";
import {
	createCalendarBackend,
	type CalendarBackend,
	type CalendarBackendOptions,
} from "./calendar-backend";
import {
	CalendarView,
	type CalendarViewActions,
} from "./calendar-view";
import {
	getCalendarGridRange,
	initialCalendarModel,
	startOfLocalDay,
	startOfMonth,
	type CalendarBackendSnapshot,
	type CalendarModel,
} from "./model";
import type { CalendarPreparationSource } from "./request";

interface CalendarControllerDependencies {
	createBackend?(options: CalendarBackendOptions): CalendarBackend;
	createView?(actions: CalendarViewActions): CalendarView;
	signalWaybar?(): void;
}

const hiddenTeardownDelaySeconds = 30;
const toggleDebounceMs = 300;

export class CalendarController {
	readonly #backend: CalendarBackend;
	readonly #view: CalendarView;
	readonly #model = initialCalendarModel();
	readonly #signalWaybar: () => void;
	readonly #preparationClaims =
		createPreparationIntentClaims<CalendarPreparationSource>();
	#initialized = false;
	#shutdownConnected = false;
	#visible = false;
	#lastToggleAtMs = 0;
	#hiddenTeardownSource = 0;

	constructor(dependencies: CalendarControllerDependencies = {}) {
		this.#signalWaybar =
			dependencies.signalWaybar ??
			(() =>
				GLib.spawn_command_line_async(
					"pkill -SIGUSR1 -f '(^|/)waybar( |$)'",
				));
		const createView =
			dependencies.createView ??
			((actions: CalendarViewActions) => new CalendarView(actions));
		this.#view = createView({
			readModel: () => this.#model,
			isVisible: () => this.#visible,
			onHide: () => this.hide(),
			onPreviousMonth: () => this.previousMonth(),
			onNextMonth: () => this.nextMonth(),
			onToday: () => this.today(),
			onSelectDate: (date) => this.selectDay(date),
			onClearSelection: () => this.clearSelection(),
			onOpenDate: (date) => this.openDate(date),
		});
		const createBackend = dependencies.createBackend ?? createCalendarBackend;
		this.#backend = createBackend({
			readRange: () => getCalendarGridRange(this.#model.visibleMonth),
			isActive: () => this.#visible || this.#preparationClaims.hasClaims(),
			applySnapshot: (snapshot) => this.#applySnapshot(snapshot),
			onRefreshComplete: () => this.#finishPreparation(),
		});
	}

	get isVisible(): boolean {
		return this.#visible;
	}

	init(): void {
		if (this.#initialized) return;
		this.#initialized = true;
		if (this.#shutdownConnected === false) {
			this.#shutdownConnected = true;
			app.connect("shutdown", () => this.teardown());
		}
		this.#backend.init();
	}

	show(): void {
		this.#cancelHiddenTeardown();
		this.#view.show();
		this.#visible = true;
		if (!this.#backend.refresh()) this.#view.render(this.#model);
		try {
			this.#signalWaybar();
		} catch (error) {
			console.error("Failed to show waybar:", error);
		}
	}

	prepare(source: CalendarPreparationSource): void {
		if (this.#preparationClaims.claim(source) === false) return;
		this.#cancelHiddenTeardown();
		this.#backend.refresh();
	}

	release(source: CalendarPreparationSource): void {
		if (this.#preparationClaims.release(source) === false || this.#visible) return;
		this.#backend.stop();
		this.#scheduleHiddenTeardown();
	}

	hide(): void {
		if (!this.#view.isCreated) return;
		this.#view.hide();
		this.#visible = false;
		if (this.#preparationClaims.hasClaims()) return;
		this.#backend.stop();
		this.#scheduleHiddenTeardown();
	}

	toggle(): void {
		const nowMs = GLib.get_monotonic_time() / 1000;
		if (nowMs - this.#lastToggleAtMs < toggleDebounceMs) return;
		this.#lastToggleAtMs = nowMs;
		if (this.#visible) this.hide();
		else this.show();
	}

	previousMonth(): void {
		const month = this.#model.visibleMonth;
		this.#model.visibleMonth = new Date(
			month.getFullYear(),
			month.getMonth() - 1,
			1,
		);
		this.#refreshOrRender();
	}

	nextMonth(): void {
		const month = this.#model.visibleMonth;
		this.#model.visibleMonth = new Date(
			month.getFullYear(),
			month.getMonth() + 1,
			1,
		);
		this.#refreshOrRender();
	}

	today(): void {
		const today = new Date();
		this.#model.visibleMonth = startOfMonth(today);
		this.#model.selectedDate = startOfLocalDay(today);
		this.#refreshOrRender();
	}

	selectDate(value: string | undefined): void {
		if (!value) return;
		const date = new Date(`${value}T00:00:00`);
		if (Number.isNaN(date.getTime())) return;
		this.#model.selectedDate = date;
		this.#model.visibleMonth = startOfMonth(date);
		this.#refreshOrRender();
	}

	teardown(): void {
		if (this.#initialized === false) return;
		this.#initialized = false;
		this.#cancelHiddenTeardown();
		this.#visible = false;
		this.#preparationClaims.clear();
		this.#backend.cooldown();
		this.#view.dispose();
	}

	#selectDay(date: Date): void {
		this.#model.selectedDate = date;
		this.#view.updateSelection(date);
	}

	#clearSelection(): void {
		this.#model.selectedDate = null;
		this.#view.updateSelection(null);
	}

	#openDate(date: Date): void {
		try {
			const launcher = new Gio.SubprocessLauncher({
				flags: Gio.SubprocessFlags.NONE,
			});
			launcher.setenv(
				"TZ",
				Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
				true,
			);
			launcher.setenv("TZDIR", GLib.file_read_link("/etc/zoneinfo"), true);
			launcher.spawnv([
				"gnome-calendar",
				"--date",
				`${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()} 00:00:00`,
			]);
			this.hide();
		} catch (error) {
			console.error("Failed to open GNOME Calendar:", error);
		}
	}

	#applySnapshot(snapshot: CalendarBackendSnapshot): void {
		this.#model.events = snapshot.events;
		this.#model.status = snapshot.status;
		this.#model.message = snapshot.message;
		this.#view.render(this.#model);
	}

	#finishPreparation(): void {
		if (this.#visible || this.#preparationClaims.clear() === false) return;
		this.#backend.stop();
		this.#scheduleHiddenTeardown();
	}

	#refreshOrRender(): void {
		if (!this.#backend.refresh()) this.#view.render(this.#model);
	}

	#scheduleHiddenTeardown(): void {
		if (this.#hiddenTeardownSource !== 0) return;
		this.#hiddenTeardownSource = GLib.timeout_add_seconds(
			GLib.PRIORITY_LOW,
			hiddenTeardownDelaySeconds,
			() => {
				this.#hiddenTeardownSource = 0;
				if (!this.#visible) {
					this.#backend.cooldown();
					this.#view.dispose();
				}
				return GLib.SOURCE_REMOVE;
			},
		);
	}

	#cancelHiddenTeardown(): void {
		if (this.#hiddenTeardownSource === 0) return;
		GLib.source_remove(this.#hiddenTeardownSource);
		this.#hiddenTeardownSource = 0;
	}
}
