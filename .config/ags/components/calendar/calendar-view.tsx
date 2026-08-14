import { Astal } from "ags/gtk4";
import app from "ags/gtk4/app";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import { bindGamingOpacity } from "../../services/gaming-opacity";
import { perf } from "../../services/performance-monitor";
import { getPointerMonitor } from "../../services/pointer-monitor";
import {
	buildCalendarDays,
	eventTooltip,
	formatMonthLabel,
	localDateKey,
	markerColor,
	type CalendarDay,
	type CalendarEventPreview,
	type CalendarModel,
	weekdayLabels,
} from "./model";

export interface CalendarViewActions {
	readModel(): CalendarModel;
	isVisible(): boolean;
	onHide(): void;
	onPreviousMonth(): void;
	onNextMonth(): void;
	onToday(): void;
	onSelectDate(date: Date): void;
	onClearSelection(): void;
	onOpenDate(date: Date): void;
}

interface DaySlot {
	button: Gtk.Button;
	number: Gtk.Label;
	markerRow: Gtk.Box;
	date: Date;
	markerSignature: string;
}

function clearBox(box: Gtk.Box): void {
	let child = box.get_first_child();
	while (child) {
		box.remove(child);
		child = box.get_first_child();
	}
}

function setCssClass(
	widget: Gtk.Widget,
	className: string,
	enabled: boolean,
): void {
	if (enabled) widget.add_css_class(className);
	else widget.remove_css_class(className);
}

function makeLabel(label: string, className: string): Gtk.Label {
	const widget = new Gtk.Label({ label });
	widget.add_css_class(className);
	return widget;
}

export class CalendarView {
	readonly #actions: CalendarViewActions;
	#win: Astal.Window | null = null;
	#calendarBox: Gtk.Box | null = null;
	#dayGridBox: Gtk.Box | null = null;
	#dayButtons = new Map<string, Gtk.Button>();
	#monthTitleLabel: Gtk.Label | null = null;
	#statusLabel: Gtk.Label | null = null;
	#weekdayLabels: Gtk.Label[] = [];
	#daySlots: DaySlot[] = [];
	#markerCssCounter = 0;
	#markerCssClasses = new Map<string, string>();

	constructor(actions: CalendarViewActions) {
		this.#actions = actions;
	}

	get isCreated(): boolean {
		return this.#win !== null;
	}

	create(): void {
		if (this.#win) return;
		this.#win = (
			<window
				name="calendar-widget"
				namespace="ags-calendar-widget"
				visible={false}
				anchor={
					Astal.WindowAnchor.TOP |
					Astal.WindowAnchor.BOTTOM |
					Astal.WindowAnchor.LEFT |
					Astal.WindowAnchor.RIGHT
				}
				layer={Astal.Layer.OVERLAY}
				exclusivity={Astal.Exclusivity.IGNORE}
				keymode={Astal.Keymode.ON_DEMAND}
				application={app}
				class="calendar-widget"
				$={(self: Astal.Window) => this.#configureWindow(self)}
			>
				<box
					orientation={Gtk.Orientation.VERTICAL}
					valign={Gtk.Align.END}
					halign={Gtk.Align.END}
				>
					<box
						orientation={Gtk.Orientation.VERTICAL}
						spacing={0}
						class="calendar-container"
						$={(self: Gtk.Box) => {
							this.#calendarBox = self;
							this.render(this.#actions.readModel());
						}}
					/>
				</box>
			</window>
		) as Astal.Window;
	}

	show(): void {
		this.create();
		this.#setTriggerMonitor();
		this.#win?.set_visible(true);
	}

	hide(): void {
		this.#win?.set_visible(false);
	}

	dispose(): void {
		this.#win?.destroy();
		this.#win = null;
		this.#calendarBox = null;
		this.#resetShellRefs();
	}

	updateSelection(selectedDate: Date | null): void {
		if (this.#dayButtons.size === 0) {
			this.render(this.#actions.readModel());
			return;
		}
		const selectedKey = selectedDate ? localDateKey(selectedDate) : null;
		for (const [dateKey, button] of this.#dayButtons)
			setCssClass(button, "selected", dateKey === selectedKey);
	}

	render(model: CalendarModel): void {
		if (!this.#calendarBox) return;
		const mark = perf.start("calendar-widget", "renderCalendar");
		try {
			if (
				this.#daySlots.length !== 42 ||
				!this.#monthTitleLabel ||
				!this.#statusLabel
			)
				this.#buildShell();
			this.#monthTitleLabel?.set_label(formatMonthLabel(model.visibleMonth));
			if (this.#statusLabel) {
				const showStatus =
					model.status !== "ready" && model.status !== "loading";
				this.#statusLabel.set_label(showStatus ? model.message : "");
				this.#statusLabel.set_visible(showStatus);
			}
			for (const [index, label] of weekdayLabels().entries())
				this.#weekdayLabels[index]?.set_label(label);
			this.#dayButtons = new Map();
			for (const [index, day] of buildCalendarDays(model).entries()) {
				const slot = this.#daySlots[index];
				if (slot) this.#updateDaySlot(slot, day);
			}
		} finally {
			mark.end();
		}
	}

	#configureWindow(win: Astal.Window): void {
		bindGamingOpacity(win);
		const keyController = new Gtk.EventControllerKey();
		keyController.connect("key-pressed", (_controller, keyval) => {
			if (keyval !== Gdk.KEY_Escape) return false;
			this.#actions.onHide();
			return true;
		});
		win.add_controller(keyController);
		const clickController = new Gtk.GestureClick();
		clickController.set_button(0);
		clickController.connect("released", (_controller, _nPress, x, y) =>
			this.#handleOutsideClick(x, y),
		);
		win.add_controller(clickController);
	}

	#setTriggerMonitor(): void {
		if (!this.#win) return;
		try {
			const pointerMonitor = getPointerMonitor();
			if (pointerMonitor) this.#win.set_gdkmonitor(pointerMonitor.monitor);
		} catch (error) {
			console.error("Failed to resolve calendar trigger monitor:", error);
		}
	}

	#handleOutsideClick(x: number, y: number): void {
		if (!this.#actions.isVisible() || !this.#calendarBox) return;
		const allocation = this.#calendarBox.get_allocation();
		if (
			x < allocation.x ||
			x > allocation.x + allocation.width ||
			y < allocation.y ||
			y > allocation.y + allocation.height
		) {
			this.#actions.onHide();
			return;
		}
		if (!this.#dayGridBox) return;
		const grid = this.#dayGridBox.get_allocation();
		const localX = x - allocation.x;
		const localY = y - allocation.y;
		const insideGrid =
			localX >= grid.x &&
			localX <= grid.x + grid.width &&
			localY >= grid.y &&
			localY <= grid.y + grid.height;
		if (!insideGrid && this.#actions.readModel().selectedDate)
			this.#actions.onClearSelection();
	}

	#buildShell(): void {
		if (!this.#calendarBox) return;
		clearBox(this.#calendarBox);
		this.#resetShellRefs();
		const header = new Gtk.Box({
			orientation: Gtk.Orientation.HORIZONTAL,
			spacing: 8,
		});
		header.add_css_class("calendar-header");
		header.append(
			this.#makeHeaderButton("‹", "previous", () =>
				this.#actions.onPreviousMonth(),
			),
		);
		const titleBox = new Gtk.Box({
			orientation: Gtk.Orientation.VERTICAL,
			spacing: 0,
		});
		titleBox.add_css_class("calendar-title-box");
		titleBox.set_hexpand(true);
		this.#monthTitleLabel = makeLabel("", "calendar-title");
		this.#monthTitleLabel.set_halign(Gtk.Align.CENTER);
		this.#statusLabel = makeLabel("", "calendar-status");
		this.#statusLabel.set_halign(Gtk.Align.CENTER);
		titleBox.append(this.#monthTitleLabel);
		titleBox.append(this.#statusLabel);
		header.append(titleBox);
		header.append(
			this.#makeHeaderButton("Today", "today-button", () =>
				this.#actions.onToday(),
			),
		);
		header.append(
			this.#makeHeaderButton("›", "next", () =>
				this.#actions.onNextMonth(),
			),
		);
		this.#calendarBox.append(header);
		const weekdays = new Gtk.Box({
			orientation: Gtk.Orientation.HORIZONTAL,
			spacing: 4,
			homogeneous: true,
		});
		weekdays.add_css_class("calendar-weekdays");
		for (let index = 0; index < 7; index++) {
			const weekday = makeLabel("", "calendar-weekday");
			weekday.set_size_request(44, 18);
			weekday.set_halign(Gtk.Align.CENTER);
			this.#weekdayLabels.push(weekday);
			weekdays.append(weekday);
		}
		this.#calendarBox.append(weekdays);
		this.#dayGridBox = new Gtk.Box({
			orientation: Gtk.Orientation.VERTICAL,
			spacing: 0,
		});
		this.#dayGridBox.add_css_class("calendar-day-grid");
		for (let rowIndex = 0; rowIndex < 6; rowIndex++) {
			const row = new Gtk.Box({
				orientation: Gtk.Orientation.HORIZONTAL,
				spacing: 0,
				homogeneous: true,
			});
			row.add_css_class("calendar-day-row");
			for (let columnIndex = 0; columnIndex < 7; columnIndex++) {
				const slot = this.#makeDayButton(rowIndex * 7 + columnIndex);
				this.#daySlots.push(slot);
				row.append(slot.button);
			}
			this.#dayGridBox.append(row);
		}
		this.#calendarBox.append(this.#dayGridBox);
	}

	#makeHeaderButton(
		label: string,
		className: string,
		onClick: () => void,
	): Gtk.Button {
		const button = new Gtk.Button({ label });
		button.add_css_class("calendar-nav-button");
		button.add_css_class(className);
		button.connect("clicked", onClick);
		button.set_cursor_from_name("pointer");
		return button;
	}

	#makeDayButton(slotIndex: number): DaySlot {
		const button = new Gtk.Button();
		button.add_css_class("calendar-day");
		if (slotIndex % 7 !== 0) button.add_css_class("not-first-column");
		if (slotIndex >= 7) button.add_css_class("not-first-row");
		button.set_size_request(48, 48);
		button.set_cursor_from_name("pointer");
		button.connect("clicked", () => {
			const slot = this.#daySlots[slotIndex];
			if (slot) this.#actions.onSelectDate(slot.date);
		});
		const doubleClick = new Gtk.GestureClick();
		doubleClick.set_button(Gdk.BUTTON_PRIMARY);
		doubleClick.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
		doubleClick.connect("pressed", (_controller, nPress) => {
			if (nPress !== 2) return;
			const slot = this.#daySlots[slotIndex];
			if (slot) this.#actions.onOpenDate(slot.date);
		});
		button.add_controller(doubleClick);
		const content = new Gtk.Box({
			orientation: Gtk.Orientation.VERTICAL,
			spacing: 0,
		});
		content.add_css_class("calendar-day-content");
		content.set_hexpand(true);
		content.set_vexpand(true);
		const number = makeLabel("", "calendar-day-number");
		number.set_halign(Gtk.Align.START);
		number.set_xalign(0);
		content.append(number);
		const spacer = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
		spacer.set_vexpand(true);
		content.append(spacer);
		const markerRow = new Gtk.Box({
			orientation: Gtk.Orientation.HORIZONTAL,
			spacing: 2,
		});
		markerRow.add_css_class("calendar-marker-row");
		markerRow.set_halign(Gtk.Align.CENTER);
		content.append(markerRow);
		button.set_child(content);
		return {
			button,
			number,
			markerRow,
			date: this.#actions.readModel().selectedDate ?? new Date(),
			markerSignature: "",
		};
	}

	#updateDaySlot(slot: DaySlot, day: CalendarDay): void {
		const dateKey = localDateKey(day.date);
		slot.date = day.date;
		slot.number.set_label(String(day.date.getDate()));
		slot.button.set_tooltip_text(eventTooltip(day));
		setCssClass(slot.button, "outside-month", !day.inVisibleMonth);
		setCssClass(slot.button, "selected", day.isSelected);
		setCssClass(slot.button, "today", day.isToday);
		this.#dayButtons.set(dateKey, slot.button);
		const markerSignature = [
			...day.markers.map((event) => `${event.id}:${markerColor(event)}`),
			`overflow:${day.markerOverflow}`,
		].join("|");
		if (slot.markerSignature === markerSignature) return;
		slot.markerSignature = markerSignature;
		clearBox(slot.markerRow);
		for (const event of day.markers) {
			const marker = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
			marker.add_css_class("calendar-event-marker");
			marker.add_css_class(this.#markerCssClass(event));
			marker.set_size_request(6, 6);
			marker.set_tooltip_text(event.title);
			slot.markerRow.append(marker);
		}
		if (day.markerOverflow > 0)
			slot.markerRow.append(
				makeLabel(`+${day.markerOverflow}`, "calendar-marker-overflow"),
			);
	}

	#markerCssClass(event: CalendarEventPreview): string {
		const color = markerColor(event);
		const cached = this.#markerCssClasses.get(color);
		if (cached) return cached;
		this.#markerCssCounter += 1;
		const className = `calendar-marker-${this.#markerCssCounter}`;
		this.#markerCssClasses.set(color, className);
		app.apply_css(
			`window.calendar-widget box.${className} { background-color: ${color}; }`,
			false,
		);
		return className;
	}

	#resetShellRefs(): void {
		this.#dayButtons = new Map();
		this.#monthTitleLabel = null;
		this.#statusLabel = null;
		this.#dayGridBox = null;
		this.#weekdayLabels = [];
		this.#daySlots = [];
	}
}
