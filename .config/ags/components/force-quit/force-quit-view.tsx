// biome-ignore-all lint/a11y/noLabelWithoutControl: GTK labels are text widgets, not HTML form labels.
// biome-ignore-all lint/a11y/useButtonType: Gtk.Button does not expose an HTML button type.

import { createRoot } from "ags";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import app from "ags/gtk4/app";
import { type IconRef, setImageFile } from "../../services/app-icons";
import { bindGamingOpacity } from "../../services/gaming-opacity";
import { configureButton } from "../button";
import {
	type ForceQuitApplication,
	type ForceQuitMetrics,
	formatForceQuitMetrics,
} from "./model";

export interface ForceQuitViewHandlers {
	onClose(): void;
	onForceQuit(): void;
	onSelect(applicationId: string): void;
	onUnmapped(): void;
}

interface ForceQuitViewState {
	applications: ForceQuitApplication[] | null;
	metrics: Map<string, ForceQuitMetrics>;
	selectedApplicationId: string | null;
	terminationPending: boolean;
}

export class ForceQuitView {
	#win: Gtk.ApplicationWindow | null = null;
	#applicationList: Gtk.Box | null = null;
	#statusLabel: Gtk.Label | null = null;
	#forceQuitButton: Gtk.Button | null = null;
	#metricLabels = new Map<string, Gtk.Label>();
	#renderDispose: (() => void) | null = null;
	#handlers: ForceQuitViewHandlers | null = null;

	get isMapped(): boolean {
		return this.#win?.get_mapped() === true;
	}

	create(handlers: ForceQuitViewHandlers): void {
		if (this.#win) return;
		this.#handlers = handlers;
		createRoot((dispose) => this.#createInScope(dispose));
	}

	present(): void {
		this.#win?.present();
	}

	render(state: ForceQuitViewState, focusFirst = false): void {
		const list = this.#applicationList;
		const status = this.#statusLabel;
		if (!list || !status) return;
		this.#disposeRender();
		clearChildren(list);
		this.#metricLabels.clear();

		if (state.applications === null) {
			status.set_label("Running applications are unavailable right now.");
			status.set_visible(true);
		} else if (state.applications.length === 0) {
			status.set_label("No running applications can be force quit.");
			status.set_visible(true);
		} else {
			status.set_visible(false);
			createRoot((dispose) => {
				this.#renderDispose = dispose;
				let firstButton: Gtk.Button | null = null;
				for (const application of state.applications ?? []) {
					const row = this.#createApplicationRow(application, state);
					firstButton ??= row;
					list.append(row);
				}
				if (focusFirst && firstButton) this.#win?.set_focus(firstButton);
			});
		}
		this.#forceQuitButton?.set_sensitive(
			state.selectedApplicationId !== null && state.terminationPending === false,
		);
	}

	updateMetrics(
		applications: ForceQuitApplication[],
		metrics: Map<string, ForceQuitMetrics>,
	): void {
		for (const application of applications)
			this.#metricLabels
				.get(application.id)
				?.set_label(formatForceQuitMetrics(metrics.get(application.id)));
	}

	destroy(): void {
		this.#disposeRender();
		const current = this.#win;
		this.#win = null;
		this.#applicationList = null;
		this.#statusLabel = null;
		this.#forceQuitButton = null;
		this.#metricLabels.clear();
		this.#handlers = null;
		current?.destroy();
	}

	#createApplicationRow(
		application: ForceQuitApplication,
		state: ForceQuitViewState,
	): Gtk.Button {
		const selected = application.id === state.selectedApplicationId;
		return (
			<button
				canFocus={true}
				class={`force-quit-row ${selected ? "selected" : ""}`}
				onClicked={() => this.#handlers?.onSelect(application.id)}
				$={(self: Gtk.Button) => self.set_cursor_from_name("pointer")}
			>
				<box orientation={Gtk.Orientation.HORIZONTAL} spacing={10}>
					{createApplicationIcon(application)}
					<label
						label={application.name}
						hexpand={true}
						xalign={0}
						ellipsize={3}
						class="force-quit-name"
					/>
					<label
						label={formatForceQuitMetrics(state.metrics.get(application.id))}
						class="force-quit-metrics"
						$={(self: Gtk.Label) => this.#metricLabels.set(application.id, self)}
					/>
				</box>
			</button>
		) as Gtk.Button;
	}

	#createInScope(dispose: () => void): void {
		const titlebar = (
			<overlay class="force-quit-titlebar">
				<label
					label="Force Quit Applications"
					class="force-quit-title"
					halign={Gtk.Align.CENTER}
				/>
				<button
					$type="overlay"
					canFocus={true}
					halign={Gtk.Align.END}
					valign={Gtk.Align.START}
					class="force-quit-close"
					onClicked={() => this.#handlers?.onClose()}
					$={(self: Gtk.Button) =>
						configureButton(self, {
							variant: "transparent",
							className: "button-shape-circle",
						})
					}
				>
					<label label={"\uE711"} />
				</button>
			</overlay>
		) as Gtk.Overlay;
		const content = (
			<box orientation={Gtk.Orientation.VERTICAL} class="force-quit-container">
				{new Gtk.WindowHandle({ child: titlebar })}
				<box
					orientation={Gtk.Orientation.VERTICAL}
					spacing={16}
					vexpand={true}
					class="force-quit-body"
				>
					<label
						class="force-quit-status"
						halign={Gtk.Align.CENTER}
						wrap={true}
						$={(self: Gtk.Label) => {
							this.#statusLabel = self;
						}}
					/>
					<scrolledwindow
						vexpand={true}
						hscrollbarPolicy={Gtk.PolicyType.NEVER}
						vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
						minContentHeight={260}
						maxContentHeight={360}
						class="force-quit-list"
					>
						<box
							orientation={Gtk.Orientation.VERTICAL}
							class="force-quit-list-content"
							$={(self: Gtk.Box) => {
								this.#applicationList = self;
							}}
						/>
					</scrolledwindow>
					<box halign={Gtk.Align.END}>
						<button
							canFocus={true}
							class="force-quit-action"
							onClicked={() => this.#handlers?.onForceQuit()}
							$={(self: Gtk.Button) => {
								this.#forceQuitButton = self;
								configureButton(self, { variant: "danger" });
								self.set_sensitive(false);
							}}
						>
							<label label="Force Quit" />
						</button>
					</box>
				</box>
			</box>
		) as Gtk.Box;

		this.#win = new Gtk.ApplicationWindow({
			application: app,
			decorated: false,
			defaultWidth: 462,
			defaultHeight: 534,
			resizable: false,
			title: "Force Quit Applications",
		});
		this.#win.set_name("force-quit");
		this.#win.add_css_class("force-quit");
		this.#win.set_child(content);
		bindGamingOpacity(this.#win);
		const keyController = new Gtk.EventControllerKey();
		keyController.connect("key-pressed", (_controller, keyval: number) => {
			if (keyval !== Gdk.KEY_Escape) return false;
			this.#handlers?.onClose();
			return true;
		});
		this.#win.add_controller(keyController);
		this.#win.connect("close-request", () => {
			this.#handlers?.onClose();
			return true;
		});
		this.#win.connect("notify::mapped", () => {
			if (this.#win?.get_mapped() === false) this.#handlers?.onUnmapped();
		});
		this.#win.connect("destroy", dispose);
	}

	#disposeRender(): void {
		this.#renderDispose?.();
		this.#renderDispose = null;
	}
}

function clearChildren(container: Gtk.Box): void {
	let child = container.get_first_child();
	while (child) {
		container.remove(child);
		child = container.get_first_child();
	}
}

function createApplicationIcon(application: ForceQuitApplication): Gtk.Widget {
	const icon: IconRef | null = application.icon;
	if (icon?.kind === "theme")
		return (
			<image iconName={icon.name} pixelSize={24} class="force-quit-icon" />
		) as Gtk.Image;
	if (icon?.kind === "file")
		return (
			<image
				pixelSize={24}
				class="force-quit-icon"
				$={(self: Gtk.Image) => setImageFile(self, icon.path)}
			/>
		) as Gtk.Image;
	return (
		<box
			class="force-quit-icon-fallback"
			widthRequest={24}
			heightRequest={24}
			halign={Gtk.Align.CENTER}
			valign={Gtk.Align.CENTER}
		>
			<label
				label={application.fallbackLetter}
				halign={Gtk.Align.CENTER}
				valign={Gtk.Align.CENTER}
				xalign={0.5}
				yalign={0.5}
			/>
		</box>
	) as Gtk.Box;
}
