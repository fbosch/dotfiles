import { Astal } from "ags/gtk4";
import app from "ags/gtk4/app";
import Gtk from "gi://Gtk?version=4.0";
import { bindGamingOpacity } from "../../services/gaming-opacity";
import { totalSegments, type VolumePresentation } from "./model";

export class VolumeIndicatorView {
	#win: Astal.Window | null = null;
	#progressSegments: Gtk.Box[] = [];
	#iconLabel: Gtk.Label | null = null;
	#volumeLabel: Gtk.Label | null = null;
	#presentation: VolumePresentation | null = null;

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
		this.#win?.set_visible(true);
	}

	hide(): void {
		this.#win?.set_visible(false);
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
		this.#win?.destroy();
		this.#win = null;
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

}
