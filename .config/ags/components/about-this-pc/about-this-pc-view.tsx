// biome-ignore-all lint/a11y/noLabelWithoutControl: GTK labels are text widgets, not HTML form labels.
// biome-ignore-all lint/a11y/useButtonType: Gtk.Button does not expose an HTML button type.

import { createRoot } from "ags";
import app from "ags/gtk4/app";
import Gdk from "gi://Gdk?version=4.0";
import Gio from "gi://Gio?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import { bindGamingOpacity } from "@/services/gaming-opacity";
import { configureButton } from "@/components/button";
import {
	aboutThisPCDetails,
	type AboutThisPCInfo,
} from "./model";

export interface AboutThisPCViewHandlers {
	onClose(): void;
	onMoreInfo(): void;
	onUnmapped(): void;
}

export class AboutThisPCView {
	#win: Gtk.ApplicationWindow | null = null;
	#artworkBox: Gtk.Box | null = null;
	#deviceNameLabel: Gtk.Label | null = null;
	#manufacturerLabel: Gtk.Label | null = null;
	#detailsBox: Gtk.Box | null = null;
	#statusLabel: Gtk.Label | null = null;
	#moreInfoButton: Gtk.Button | null = null;
	#artworkTexture: { path: string; texture: Gdk.Texture } | null = null;
	#renderDispose: (() => void) | null = null;
	#handlers: AboutThisPCViewHandlers | null = null;

	get isMapped(): boolean {
		return this.#win?.get_mapped() === true;
	}

	create(handlers: AboutThisPCViewHandlers): void {
		if (this.#win) return;
		this.#handlers = handlers;
		createRoot((dispose) => this.#createInScope(dispose));
	}

	present(): void {
		this.#win?.present();
	}

	focusMoreInfo(): void {
		this.#win?.set_focus(this.#moreInfoButton);
	}

	showStatus(message: string): void {
		this.#statusLabel?.set_label(message);
		this.#statusLabel?.set_visible(true);
	}

	hideStatus(): void {
		this.#statusLabel?.set_visible(false);
	}

	render(info: AboutThisPCInfo): void {
		const artwork = this.#artworkBox;
		const deviceName = this.#deviceNameLabel;
		const manufacturer = this.#manufacturerLabel;
		const detailsBox = this.#detailsBox;
		if (!artwork || !deviceName || !manufacturer || !detailsBox) return;
		this.#disposeRender();
		clearChildren(artwork);
		clearChildren(detailsBox);
		deviceName.set_label(info.deviceName);
		manufacturer.set_label(info.manufacturer ?? "");
		manufacturer.set_visible(Boolean(info.manufacturer));
		createRoot((dispose) => {
			this.#renderDispose = dispose;
			artwork.append(this.#createArtwork(info));
			for (const detail of aboutThisPCDetails(info))
				detailsBox.append(detailRow(detail.label, detail.value, detail.icon));
		});
		this.hideStatus();
	}

	destroy(): void {
		this.#disposeRender();
		const current = this.#win;
		this.#win = null;
		this.#artworkBox = null;
		this.#deviceNameLabel = null;
		this.#manufacturerLabel = null;
		this.#detailsBox = null;
		this.#statusLabel = null;
		this.#moreInfoButton = null;
		this.#artworkTexture = null;
		this.#handlers = null;
		current?.destroy();
	}

	#createArtwork(info: AboutThisPCInfo): Gtk.Widget {
		if (!info.deviceImagePath)
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
		const picture = new Gtk.Picture({
			contentFit: Gtk.ContentFit.CONTAIN,
			canShrink: true,
			halign: Gtk.Align.FILL,
			hexpand: true,
			widthRequest: 320,
			heightRequest: 144,
		});
		if (this.#artworkTexture?.path !== info.deviceImagePath)
			this.#artworkTexture = {
				path: info.deviceImagePath,
				texture: Gdk.Texture.new_from_file(Gio.File.new_for_path(info.deviceImagePath)),
			};
		picture.set_paintable(this.#artworkTexture.texture);
		return picture;
	}

	#createInScope(dispose: () => void): void {
		const titlebar = (
			<overlay class="about-titlebar">
				<button
					$type="overlay"
					canFocus={true}
					halign={Gtk.Align.END}
					valign={Gtk.Align.START}
					class="about-close"
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
			<box orientation={Gtk.Orientation.VERTICAL} class="about-container" halign={Gtk.Align.FILL}>
				{new Gtk.WindowHandle({ child: titlebar })}
				<box class="about-content" orientation={Gtk.Orientation.VERTICAL} halign={Gtk.Align.FILL}>
					<box
						class="about-artwork"
						halign={Gtk.Align.FILL}
						valign={Gtk.Align.CENTER}
						$={(self: Gtk.Box) => {
							this.#artworkBox = self;
						}}
					/>
					<label
						class="about-device-name"
						wrap={true}
						$={(self: Gtk.Label) => {
							this.#deviceNameLabel = self;
						}}
					/>
					<label
						class="about-manufacturer"
						$={(self: Gtk.Label) => {
							this.#manufacturerLabel = self;
						}}
					/>
					<box
						class="about-details"
						orientation={Gtk.Orientation.VERTICAL}
						$={(self: Gtk.Box) => {
							this.#detailsBox = self;
						}}
					/>
					<label
						class="about-status"
						wrap={true}
						visible={false}
						$={(self: Gtk.Label) => {
							this.#statusLabel = self;
						}}
					/>
					<box class="about-actions" halign={Gtk.Align.CENTER} valign={Gtk.Align.END} vexpand={true}>
						<button
							canFocus={true}
							class="about-more-info"
							onClicked={() => this.#handlers?.onMoreInfo()}
							$={(self: Gtk.Button) => {
								this.#moreInfoButton = self;
								configureButton(self, { variant: "default" });
							}}
						>
							<label label="More Info..." />
						</button>
					</box>
				</box>
			</box>
		) as Gtk.Box;

		this.#win = new Gtk.ApplicationWindow({
			application: app,
			decorated: false,
			defaultWidth: 420,
			defaultHeight: 560,
			resizable: false,
			title: "About This PC",
		});
		this.#win.set_name("about-this-pc");
		this.#win.add_css_class("about-this-pc");
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

function detailRow(label: string, value: string, icon?: string): Gtk.Widget {
	return (
		<box class="about-detail-row" orientation={Gtk.Orientation.HORIZONTAL}>
			<label label={label} class="about-detail-label" halign={Gtk.Align.END} xalign={1} />
			<box class="about-detail-content" orientation={Gtk.Orientation.HORIZONTAL} spacing={6} hexpand={true}>
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
