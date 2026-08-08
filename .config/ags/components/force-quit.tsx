// biome-ignore-all lint/a11y/noLabelWithoutControl: GTK labels are text widgets, not HTML form labels.
// biome-ignore-all lint/a11y/useButtonType: Gtk.Button does not expose an HTML button type.

import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import { createRoot } from "ags";
import app from "ags/gtk4/app";
import tokens from "../../../design-system/tokens.json";
import { type IconRef, setImageFile } from "../services/app-icons";
import {
	clearForceQuitMetricSamples,
	type ForceQuitApplication,
	type ForceQuitMetrics,
	forceQuitApplication,
	getForceQuitApplications,
	getForceQuitMetrics,
} from "../services/force-quit";
import { bindGamingOpacity } from "../services/gaming-opacity";
import { dispatchHyprland } from "../services/hyprland-ipc";
import { parseComponentRequest } from "../services/request";
import { configureButton } from "./button";

const metricRefreshMs = 2_000;

let win: Gtk.ApplicationWindow | null = null;
let applicationList: Gtk.Box | null = null;
let statusLabel: Gtk.Label | null = null;
let forceQuitButton: Gtk.Button | null = null;
let metricRefreshTimer: number | null = null;
let isVisible = false;
let selectedApplicationId: string | null = null;
let applications: ForceQuitApplication[] | null = [];
let metrics = new Map<string, ForceQuitMetrics>();
const metricLabels = new Map<string, Gtk.Label>();
let terminationPending = false;
let applicationRenderDispose: (() => void) | null = null;

function clearChildren(container: Gtk.Box): void {
	let child = container.get_first_child();
	while (child) {
		container.remove(child);
		child = container.get_first_child();
	}
}

function disposeApplicationRender(): void {
	applicationRenderDispose?.();
	applicationRenderDispose = null;
}

function formatMemory(bytes: number): string {
	if (bytes >= 1024 * 1024 * 1024)
		return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
	return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function formatMetrics(metric: ForceQuitMetrics | undefined): string {
	if (!metric) return "-- · --";
	const cpu =
		metric.cpuPercent === null ? "--" : `${metric.cpuPercent.toFixed(1)}%`;
	return `${cpu} · ${formatMemory(metric.residentMemoryBytes)}`;
}

function createApplicationIcon(application: ForceQuitApplication): Gtk.Widget {
	const icon: IconRef | null = application.icon;
	if (icon?.kind === "theme") {
		return (
			<image iconName={icon.name} pixelSize={24} class="force-quit-icon" />
		) as Gtk.Image;
	}

	if (icon?.kind === "file") {
		return (
			<image
				pixelSize={24}
				class="force-quit-icon"
				$={(self: Gtk.Image) => setImageFile(self, icon.path)}
			/>
		) as Gtk.Image;
	}

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

function renderApplications(): void {
	if (!applicationList || !statusLabel) return;
	disposeApplicationRender();
	clearChildren(applicationList);
	metricLabels.clear();

	if (applications === null) {
		statusLabel.set_label("Running applications are unavailable right now.");
		statusLabel.set_visible(true);
	} else if (applications.length === 0) {
		statusLabel.set_label("No running applications can be force quit.");
		statusLabel.set_visible(true);
	} else {
		statusLabel.set_visible(false);
		createRoot((dispose) => {
			applicationRenderDispose = dispose;
			let firstApplicationButton: Gtk.Button | null = null;
			for (const application of applications) {
				const selected = application.id === selectedApplicationId;
				const row = (
					<button
						canFocus={true}
						class={`force-quit-row ${selected ? "selected" : ""}`}
						onClicked={() => {
							selectedApplicationId = application.id;
							renderApplications();
						}}
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
								label={formatMetrics(metrics.get(application.id))}
								class="force-quit-metrics"
								$={(self: Gtk.Label) => {
									metricLabels.set(application.id, self);
								}}
							/>
						</box>
					</button>
				) as Gtk.Button;
				firstApplicationButton ??= row;
				applicationList.append(row);
			}
			if (isVisible === false && firstApplicationButton) {
				win?.set_focus(firstApplicationButton);
			}
		});
	}

	forceQuitButton?.set_sensitive(
		selectedApplicationId !== null && terminationPending === false,
	);
}

function forceQuitSelectedApplication(): void {
	if (terminationPending || !applications || !selectedApplicationId) return;

	const selected = applications.find(
		(application) => application.id === selectedApplicationId,
	);
	if (!selected) {
		selectedApplicationId = null;
		renderApplications();
		return;
	}

	terminationPending = true;
	forceQuitButton?.set_sensitive(false);
	forceQuitApplication(selected, () => {
		terminationPending = false;
		selectedApplicationId = null;
		if (isVisible) refreshApplications();
	});
}

function refreshMetrics(): void {
	if (!isVisible || !applications) return;
	metrics = getForceQuitMetrics(applications);
	for (const application of applications) {
		metricLabels
			.get(application.id)
			?.set_label(formatMetrics(metrics.get(application.id)));
	}
}

function applicationTopologyMatches(
	left: ForceQuitApplication[] | null,
	right: ForceQuitApplication[] | null,
): boolean {
	if (!left || !right) return left === right;
	if (left.length !== right.length) return false;

	const rightById = new Map(
		right.map((application) => [application.id, application]),
	);
	return left.every((application) => {
		const candidate = rightById.get(application.id);
		if (!candidate) return false;
		if (application.pids.join(",") !== candidate.pids.join(",")) return false;

		const windows = application.windows
			.map((window) => `${window.address}:${window.pid}`)
			.sort()
			.join(",");
		const candidateWindows = candidate.windows
			.map((window) => `${window.address}:${window.pid}`)
			.sort()
			.join(",");
		return windows === candidateWindows;
	});
}

function refreshVisibleState(): void {
	if (!isVisible) return;
	const display = Gdk.Display.get_default();
	const iconTheme = display ? Gtk.IconTheme.get_for_display(display) : null;
	const latestApplications = getForceQuitApplications(iconTheme);
	const topologyChanged =
		applicationTopologyMatches(applications, latestApplications) === false;
	applications = latestApplications;

	if (
		applications?.some(
			(application) => application.id === selectedApplicationId,
		) === false
	) {
		selectedApplicationId = null;
	}

	if (topologyChanged) {
		metrics = applications ? getForceQuitMetrics(applications) : new Map();
		renderApplications();
		return;
	}
	refreshMetrics();
}

function clearMetricRefreshTimer(): void {
	if (metricRefreshTimer === null) return;
	GLib.source_remove(metricRefreshTimer);
	metricRefreshTimer = null;
}

function startMetricRefreshTimer(): void {
	clearMetricRefreshTimer();
	metricRefreshTimer = GLib.timeout_add(
		GLib.PRIORITY_DEFAULT,
		metricRefreshMs,
		() => {
			refreshVisibleState();
			return GLib.SOURCE_CONTINUE;
		},
	);
}

function refreshApplications(): void {
	const display = Gdk.Display.get_default();
	const iconTheme = display ? Gtk.IconTheme.get_for_display(display) : null;
	applications = getForceQuitApplications(iconTheme);
	if (
		applications?.some(
			(application) => application.id === selectedApplicationId,
		) === false
	) {
		selectedApplicationId = null;
	}
	metrics = applications ? getForceQuitMetrics(applications) : new Map();
	renderApplications();
}

function hideForceQuit(): void {
	destroyForceQuit();
}

function showForceQuit(): void {
	if (win?.get_mapped() === true) {
		win.present();
		dispatchHyprland(
			'hl.dsp.focus({ window = "title:^(Force Quit Applications)$" })',
			{ component: "force-quit", metric: "focus" },
		);
		return;
	}
	destroyForceQuit();
	createWindow();
	clearForceQuitMetricSamples();
	refreshApplications();
	win?.present();
	isVisible = true;
	startMetricRefreshTimer();
}

function destroyForceQuit(): void {
	clearMetricRefreshTimer();
	clearForceQuitMetricSamples();
	disposeApplicationRender();
	const currentWindow = win;
	win = null;
	applicationList = null;
	statusLabel = null;
	forceQuitButton = null;
	metricLabels.clear();
	isVisible = false;
	selectedApplicationId = null;
	currentWindow?.destroy();
}

function createWindow(): void {
	createRoot((dispose) => createWindowInScope(dispose));
}

function createWindowInScope(dispose: () => void): void {
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
				onClicked={hideForceQuit}
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
						statusLabel = self;
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
							applicationList = self;
						}}
					/>
				</scrolledwindow>
				<box halign={Gtk.Align.END}>
					<button
						canFocus={true}
						class="force-quit-action"
						onClicked={forceQuitSelectedApplication}
						$={(self: Gtk.Button) => {
							forceQuitButton = self;
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

	win = new Gtk.ApplicationWindow({
		application: app,
		decorated: false,
		defaultWidth: 462,
		defaultHeight: 534,
		resizable: false,
		title: "Force Quit Applications",
	});
	win.set_name("force-quit");
	win.add_css_class("force-quit");
	win.set_child(content);
	bindGamingOpacity(win);

	const keyController = new Gtk.EventControllerKey();
	keyController.connect("key-pressed", (_controller, keyval: number) => {
		if (keyval !== Gdk.KEY_Escape) return false;
		hideForceQuit();
		return true;
	});
	win.add_controller(keyController);
	win.connect("close-request", () => {
		destroyForceQuit();
		return true;
	});
	win.connect("notify::visible", () => {
		if (win?.get_visible() === false) clearMetricRefreshTimer();
	});
	win.connect("notify::mapped", () => {
		if (win?.get_mapped() === true) return;
		isVisible = false;
		clearMetricRefreshTimer();
		clearForceQuitMetricSamples();
	});
	win.connect("destroy", dispose);
}

function applyStaticCss(): void {
	app.apply_css(
		`
		window.force-quit { background-color: transparent; border: none; padding: 0; }
		window.force-quit box.force-quit-container {
			min-width: 420px; min-height: 500px;
			border: 1px solid ${tokens.colors.border.hover.value}; border-radius: 12px;
			background-color: rgba(45, 45, 45, 0.90);
		}
		window.force-quit overlay.force-quit-titlebar { min-height: 36px; }
		window.force-quit box.force-quit-body { padding: 0 20px 20px; }
		window.force-quit label.force-quit-title { color: ${tokens.colors.foreground.primary.value}; font-size: 16px; font-weight: 600; }
		window.force-quit button.force-quit-close { min-width: 32px; min-height: 32px; padding: 0; margin: 3px 4px 0 0; }
		window.force-quit button.force-quit-close label { font-family: "Segoe Fluent Icons", "Segoe UI Symbol", sans-serif; font-size: 12px; }
		window.force-quit label.force-quit-status { color: ${tokens.colors.foreground.tertiary.value}; font-size: 14px; margin: 16px; }
		window.force-quit scrolledwindow.force-quit-list { border: 1px solid rgba(255, 255, 255, 0.20); border-radius: 8px; background-color: rgba(0, 0, 0, 0.12); }
		window.force-quit box.force-quit-list-content { padding: 4px; }
		window.force-quit button.force-quit-row { min-height: 36px; padding: 0 8px; border: none; border-radius: 6px; background-color: transparent; color: ${tokens.colors.foreground.primary.value}; }
		window.force-quit button.force-quit-row:hover, window.force-quit button.force-quit-row:focus { background-color: rgba(255, 255, 255, 0.10); }
		window.force-quit button.force-quit-row.selected { background-color: ${tokens.colors.accent.primary.value}; color: #ffffff; }
		window.force-quit image.force-quit-icon, window.force-quit box.force-quit-icon-fallback { min-width: 24px; min-height: 24px; }
		window.force-quit box.force-quit-icon-fallback { border-radius: 4px; background-color: rgba(255, 255, 255, 0.10); }
		window.force-quit box.force-quit-icon-fallback label { min-width: 24px; min-height: 24px; font-size: 12px; font-weight: 600; }
		window.force-quit label.force-quit-name { font-size: 14px; font-weight: 500; color: inherit; }
		window.force-quit label.force-quit-metrics { font-size: 13px; color: ${tokens.colors.foreground.tertiary.value}; }
		window.force-quit button.force-quit-row.selected label.force-quit-metrics { color: rgba(255, 255, 255, 0.80); }
		window.force-quit button.force-quit-action { min-height: 32px; padding: 4px 12px; font-weight: 600; }
		`,
		false,
	);
}

function handleForceQuitRequest(
	argv: string[],
	res: (response: string) => void,
): void {
	const data = parseComponentRequest<{ action?: string }>(
		"force-quit",
		argv,
		res,
	);
	if (!data) return;

	if (data.action === "is-visible") {
		res(win?.get_mapped() === true ? "true" : "false");
		return;
	}
	if (data.action === "show") {
		showForceQuit();
		res("shown");
		return;
	}
	if (data.action === "hide") {
		hideForceQuit();
		res("hidden");
		return;
	}
	if (data.action === "destroy") {
		destroyForceQuit();
		res("destroyed");
		return;
	}
	res("unknown action");
}

function initForceQuit(): void {
	applyStaticCss();
}

globalThis.ForceQuit = {
	init: initForceQuit,
	handleRequest: handleForceQuitRequest,
	instanceName: "force-quit",
	show: showForceQuit,
};
