// biome-ignore-all lint/a11y/noLabelWithoutControl: GTK labels are text widgets, not HTML form labels.
// biome-ignore-all lint/a11y/useButtonType: Gtk.Button does not expose an HTML button type.

import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import app from "ags/gtk4/app";
import tokens from "../../../design-system/tokens.json";
import {
	type AboutThisPCInfo,
	getAboutThisPCInfo,
	launchAboutMoreInfo,
} from "../services/about-this-pc";
import { bindGamingOpacity } from "../services/gaming-opacity";
import { dispatchHyprland } from "../services/hyprland-ipc";
import { parseComponentRequest } from "../services/request";
import { configureButton } from "./button";

let win: Gtk.ApplicationWindow | null = null;
let artworkBox: Gtk.Box | null = null;
let deviceNameLabel: Gtk.Label | null = null;
let manufacturerLabel: Gtk.Label | null = null;
let detailsBox: Gtk.Box | null = null;
let statusLabel: Gtk.Label | null = null;
let moreInfoButton: Gtk.Button | null = null;

function clearChildren(container: Gtk.Box): void {
	let child = container.get_first_child();
	while (child) {
		container.remove(child);
		child = container.get_first_child();
	}
}

function createArtwork(info: AboutThisPCInfo): Gtk.Widget {
	if (info.deviceImagePath) {
		return new Gtk.Picture({
			filename: info.deviceImagePath,
			contentFit: Gtk.ContentFit.CONTAIN,
			canShrink: true,
			halign: Gtk.Align.FILL,
			hexpand: true,
			widthRequest: 320,
			heightRequest: 144,
		});
	}

	return (
		<label
			label={info.deviceIcon}
			class="about-device-icon"
			halign={Gtk.Align.FILL}
			valign={Gtk.Align.CENTER}
			hexpand={true}
			xalign={0.5}
		/>
	) as Gtk.Label;
}

function combinedValue(
	primary?: string,
	secondary?: string,
): string | undefined {
	if (primary) return secondary ? `${primary} (${secondary})` : primary;
	return secondary;
}

function operatingSystemValue(info: AboutThisPCInfo): string | undefined {
	if (info.nixosGeneration && info.operatingSystem) {
		const name = [info.operatingSystem, info.operatingSystemCodename]
			.filter(Boolean)
			.join(" ");
		return `${name} (${info.nixosGeneration})`;
	}
	return combinedValue(info.operatingSystem, info.operatingSystemCodename);
}

function detailRow(label: string, value: string, icon?: string): Gtk.Widget {
	return (
		<box class="about-detail-row" orientation={Gtk.Orientation.HORIZONTAL}>
			<label
				label={label}
				class="about-detail-label"
				halign={Gtk.Align.END}
				xalign={1}
			/>
			<box
				class="about-detail-content"
				orientation={Gtk.Orientation.HORIZONTAL}
				spacing={6}
				hexpand={true}
			>
				{icon ? <label label={icon} class="about-detail-icon" /> : null}
				<label
					label={value}
					class="about-detail-value"
					halign={Gtk.Align.FILL}
					xalign={0}
					hexpand={true}
					wrap={true}
					wrapMode={2}
				/>
			</box>
		</box>
	) as Gtk.Box;
}

function renderInfo(info: AboutThisPCInfo): void {
	if (!artworkBox || !deviceNameLabel || !manufacturerLabel || !detailsBox) {
		return;
	}

	clearChildren(artworkBox);
	artworkBox.append(createArtwork(info));
	deviceNameLabel.set_label(info.deviceName);
	manufacturerLabel.set_label(info.manufacturer ?? "");
	manufacturerLabel.set_visible(Boolean(info.manufacturer));

	clearChildren(detailsBox);
	const details: Array<[string, string | undefined, string?]> = [
		["CPU", combinedValue(info.processor, info.processorClock)],
		["GPU", info.graphics],
		["Memory", combinedValue(info.memory, info.memoryClock)],
		["Desktop", info.desktop],
		["OS", operatingSystemValue(info), info.operatingSystemIcon],
		["Kernel", info.kernel],
		["Uptime", info.uptime],
	];
	for (const [label, value, icon] of details) {
		if (value) detailsBox.append(detailRow(label, value, icon));
	}
	statusLabel?.set_visible(false);
}

function showMoreInfo(): void {
	if (launchAboutMoreInfo()) {
		statusLabel?.set_visible(false);
		return;
	}
	statusLabel?.set_label(
		"The More Info command or a supported terminal is unavailable.",
	);
	statusLabel?.set_visible(true);
}

function hideAboutThisPC(): void {
	destroyAboutThisPC();
}

function showAboutThisPC(): void {
	if (win?.get_mapped() === true) {
		win.present();
		dispatchHyprland('hl.dsp.focus({ window = "title:^(About This PC)$" })', {
			component: "about-this-pc",
			metric: "focus",
		});
		return;
	}
	destroyAboutThisPC();
	createWindow();
	renderInfo(getAboutThisPCInfo());
	win?.present();
	win?.set_focus(moreInfoButton);
}

function destroyAboutThisPC(): void {
	const currentWindow = win;
	win = null;
	artworkBox = null;
	deviceNameLabel = null;
	manufacturerLabel = null;
	detailsBox = null;
	statusLabel = null;
	moreInfoButton = null;
	currentWindow?.destroy();
}

function createWindow(): void {
	const titlebar = (
		<overlay class="about-titlebar">
			<button
				$type="overlay"
				canFocus={true}
				halign={Gtk.Align.END}
				valign={Gtk.Align.START}
				class="about-close"
				onClicked={hideAboutThisPC}
				$={(self: Gtk.Button) =>
					configureButton(self, { variant: "transparent" })
				}
			>
				<label label={"\uE711"} />
			</button>
		</overlay>
	) as Gtk.Overlay;
	const content = (
		<box
			orientation={Gtk.Orientation.VERTICAL}
			class="about-container"
			halign={Gtk.Align.FILL}
		>
			{new Gtk.WindowHandle({ child: titlebar })}
			<box
				class="about-content"
				orientation={Gtk.Orientation.VERTICAL}
				halign={Gtk.Align.FILL}
			>
				<box
					class="about-artwork"
					halign={Gtk.Align.FILL}
					valign={Gtk.Align.CENTER}
					$={(self: Gtk.Box) => {
						artworkBox = self;
					}}
				/>
				<label
					class="about-device-name"
					wrap={true}
					$={(self: Gtk.Label) => {
						deviceNameLabel = self;
					}}
				/>
				<label
					class="about-manufacturer"
					$={(self: Gtk.Label) => {
						manufacturerLabel = self;
					}}
				/>
				<box
					class="about-details"
					orientation={Gtk.Orientation.VERTICAL}
					$={(self: Gtk.Box) => {
						detailsBox = self;
					}}
				/>
				<label
					class="about-status"
					wrap={true}
					visible={false}
					$={(self: Gtk.Label) => {
						statusLabel = self;
					}}
				/>
				<box
					class="about-actions"
					halign={Gtk.Align.CENTER}
					valign={Gtk.Align.END}
					vexpand={true}
				>
					<button
						canFocus={true}
						class="about-more-info"
						onClicked={showMoreInfo}
						$={(self: Gtk.Button) => {
							moreInfoButton = self;
							configureButton(self, { variant: "default" });
						}}
					>
						<label label="More Info..." />
					</button>
				</box>
			</box>
		</box>
	) as Gtk.Box;

	win = new Gtk.ApplicationWindow({
		application: app,
		decorated: false,
		defaultWidth: 420,
		defaultHeight: 560,
		resizable: false,
		title: "About This PC",
	});
	win.set_name("about-this-pc");
	win.add_css_class("about-this-pc");
	win.set_child(content);
	bindGamingOpacity(win);

	const keyController = new Gtk.EventControllerKey();
	keyController.connect("key-pressed", (_controller, keyval: number) => {
		if (keyval !== Gdk.KEY_Escape) return false;
		hideAboutThisPC();
		return true;
	});
	win.add_controller(keyController);
	win.connect("close-request", () => {
		destroyAboutThisPC();
		return true;
	});
}

function applyStaticCss(): void {
	app.apply_css(
		`
		window.about-this-pc { background-color: transparent; border: none; padding: 0; }
		window.about-this-pc box.about-container {
			min-width: 420px; min-height: 560px;
			border: 1px solid ${tokens.colors.border.hover.value}; border-radius: 12px;
			background-color: rgba(45, 45, 45, 0.90);
		}
		window.about-this-pc overlay.about-titlebar { min-height: 36px; }
		window.about-this-pc button.about-close { min-width: 32px; min-height: 32px; padding: 0; margin: 3px 4px 0 0; }
		window.about-this-pc button.about-close label { font-family: "Segoe Fluent Icons", "Segoe UI Symbol", sans-serif; font-size: 12px; }
		window.about-this-pc box.about-content { padding: 0 32px 28px; }
		window.about-this-pc box.about-artwork { min-height: 144px; }
		window.about-this-pc box.about-artwork picture { min-width: 320px; min-height: 144px; }
		window.about-this-pc label.about-device-icon { min-width: 320px; min-height: 144px; color: ${tokens.colors.foreground.secondary.value}; font-family: "Segoe Fluent Icons", "Segoe UI Symbol", sans-serif; font-size: 72px; }
		window.about-this-pc label.about-device-name { margin-top: 12px; color: ${tokens.colors.foreground.primary.value}; font-size: 24px; font-weight: 600; }
		window.about-this-pc label.about-manufacturer { margin-top: 2px; color: ${tokens.colors.foreground.tertiary.value}; font-size: 14px; }
		window.about-this-pc box.about-details { margin: 24px 12px 0; }
		window.about-this-pc box.about-detail-row { min-height: 23px; }
		window.about-this-pc label.about-detail-label { min-width: 68px; margin-right: 16px; color: ${tokens.colors.foreground.primary.value}; font-size: 14px; font-weight: 500; }
		window.about-this-pc label.about-detail-icon { color: ${tokens.colors.foreground.secondary.value}; font-family: "Symbols Nerd Font", monospace; font-size: 14px; }
		window.about-this-pc label.about-detail-value { color: ${tokens.colors.foreground.secondary.value}; font-size: 14px; }
		window.about-this-pc label.about-status { margin-top: 8px; color: ${tokens.colors.state.error.value}; font-size: 13px; }
		window.about-this-pc box.about-actions { padding-top: 20px; }
		window.about-this-pc button.about-more-info { min-height: 32px; padding: 4px 12px; font-weight: 600; }
		`,
		false,
	);
}

function handleAboutThisPCRequest(
	argv: string[],
	res: (response: string) => void,
): void {
	const data = parseComponentRequest<{ action?: string }>(
		"about-this-pc",
		argv,
		res,
	);
	if (!data) return;

	if (data.action === "is-visible") {
		res(win?.get_mapped() === true ? "true" : "false");
		return;
	}
	if (data.action === "show") {
		showAboutThisPC();
		res("shown");
		return;
	}
	if (data.action === "hide") {
		hideAboutThisPC();
		res("hidden");
		return;
	}
	if (data.action === "destroy") {
		destroyAboutThisPC();
		res("destroyed");
		return;
	}

	res("unknown action");
}

function initAboutThisPC(): void {
	applyStaticCss();
}

globalThis.AboutThisPC = {
	init: initAboutThisPC,
	handleRequest: handleAboutThisPCRequest,
	instanceName: "about-this-pc",
	show: showAboutThisPC,
};
