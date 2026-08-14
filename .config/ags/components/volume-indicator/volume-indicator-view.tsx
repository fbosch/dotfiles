import { Astal } from "ags/gtk4";
import app from "ags/gtk4/app";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import { bindGamingOpacity } from "../../services/gaming-opacity";
import { totalSegments, type VolumePresentation } from "./model";

export class VolumeIndicatorView {
	#win: Astal.Window | null = null;
	#shadowWrapper: Gtk.Box | null = null;
	#progressSegments: Gtk.Box[] = [];
	#iconLabel: Gtk.Label | null = null;
	#volumeLabel: Gtk.Label | null = null;
	#presentation: VolumePresentation | null = null;
	#fadeSource = 0;

	get isCreated(): boolean {
		return this.#win !== null;
	}
	get segmentCount(): number {
		return this.#progressSegments.length;
	}

	create(): void {
		if (this.#win) return;
		const segments = Array.from({ length: totalSegments }, (_, index) => (
			<box
				class="progress-square empty"
				$={(self: Gtk.Box) => {
					self.set_size_request(8, 8);
					this.#progressSegments[index] = self;
				}}
			/>
		));
		this.#win = (
			<window
				name="volume-indicator"
				namespace="ags-volume-indicator"
				visible={false}
				anchor={Astal.WindowAnchor.NONE}
				layer={Astal.Layer.OVERLAY}
				exclusivity={Astal.Exclusivity.NORMAL}
				keymode={Astal.Keymode.NONE}
				class="volume-indicator"
				application={app}
				$={(self: Astal.Window) => bindGamingOpacity(self)}
			>
				<box
					orientation={Gtk.Orientation.HORIZONTAL}
					halign={Gtk.Align.CENTER}
					valign={Gtk.Align.CENTER}
					class="shadow-wrapper"
					$={(self: Gtk.Box) => {
						this.#shadowWrapper = self;
					}}
				>
					<box
						orientation={Gtk.Orientation.HORIZONTAL}
						spacing={0}
						class="indicator-container"
					>
						<box
							orientation={Gtk.Orientation.HORIZONTAL}
							halign={Gtk.Align.CENTER}
							valign={Gtk.Align.CENTER}
							class="icon-container"
						>
							<label
								label=""
								class="speaker-icon"
								$={(self: Gtk.Label) => {
									this.#iconLabel = self;
								}}
							/>
						</box>
						<box
							orientation={Gtk.Orientation.HORIZONTAL}
							spacing={2}
							valign={Gtk.Align.CENTER}
							class="progress-container"
						>
							{segments}
						</box>
						<label
							label="0%"
							class="volume-label"
							halign={Gtk.Align.END}
							xalign={1}
							$={(self: Gtk.Label) => {
								this.#volumeLabel = self;
							}}
						/>
					</box>
				</box>
			</window>
		) as Astal.Window;
	}

	show(): void {
		this.create();
		this.#cancelFadeSource();
		this.#win?.set_visible(true);
		this.#shadowWrapper?.remove_css_class("hiding");
		this.#fadeSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
			this.#fadeSource = 0;
			this.#shadowWrapper?.add_css_class("visible");
			return GLib.SOURCE_REMOVE;
		});
	}

	beginHide(): void {
		this.#cancelFadeSource();
		this.#shadowWrapper?.remove_css_class("visible");
		this.#shadowWrapper?.add_css_class("hiding");
	}

	hide(): void {
		this.#cancelFadeSource();
		this.#win?.set_visible(false);
		this.#shadowWrapper?.remove_css_class("visible");
		this.#shadowWrapper?.remove_css_class("hiding");
	}

	setPresentation(next: VolumePresentation): void {
		const previous = this.#presentation;
		if (
			previous?.volume === next.volume &&
			previous.muted === next.muted
		)
			return;
		if (previous?.speakerState !== next.speakerState) {
			this.#iconLabel?.set_label(next.icon);
			this.#setCssClass(
				this.#iconLabel,
				"muted",
				next.speakerState === "muted",
			);
		}
		this.#volumeLabel?.set_label(next.label);
		this.#setCssClass(
			this.#volumeLabel,
			"muted",
			next.muted || next.volume === 0,
		);
		const previousFilled = previous?.filledSegments ?? 0;
		const minChanged = Math.min(previousFilled, next.filledSegments);
		const maxChanged = Math.max(previousFilled, next.filledSegments);
		for (let index = minChanged; index < maxChanged; index++) {
			const segment = this.#progressSegments[index];
			if (!segment) continue;
			this.#setCssClass(segment, "filled", index < next.filledSegments);
			this.#setCssClass(segment, "empty", index >= next.filledSegments);
		}
		this.#presentation = next;
	}

	dispose(): void {
		this.#cancelFadeSource();
		this.#win?.destroy();
		this.#win = null;
		this.#shadowWrapper = null;
		this.#progressSegments = [];
		this.#iconLabel = null;
		this.#volumeLabel = null;
		this.#presentation = null;
	}

	#setCssClass(
		widget: Gtk.Widget | null,
		className: string,
		enabled: boolean,
	): void {
		if (!widget) return;
		if (enabled) widget.add_css_class(className);
		else widget.remove_css_class(className);
	}

	#cancelFadeSource(): void {
		if (this.#fadeSource === 0) return;
		GLib.source_remove(this.#fadeSource);
		this.#fadeSource = 0;
	}
}
