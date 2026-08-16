import { Astal } from "ags/gtk4";
import app from "ags/gtk4/app";
import { createRoot } from "ags";
import Gdk from "gi://Gdk?version=4.0";
import Gio from "gi://Gio?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import { configureButton } from "@/components/button";
import { bindGamingOpacity } from "@/services/gaming-opacity";
import { getPointerMonitor } from "@/services/pointer-monitor";
import type { AccessibilityMetadata } from "./accessibility-policy";
import type { Capture } from "./capture";
import type { PointerStroke } from "./stroke";
import { StrokeOverlay } from "./stroke-overlay";

export interface AiPointerViewHandlers {
	onCancel(): void;
}

export class AiPointerView {
	#window: Astal.Window | null = null;
	#preview: Gtk.Picture | null = null;
	#geometry: Gtk.Label | null = null;
	#program: Gtk.Label | null = null;
	#target: Gtk.Label | null = null;
	#evidence: Gtk.Label | null = null;
	#status: Gtk.Label | null = null;
	#handlers: AiPointerViewHandlers | null = null;
	readonly #strokeOverlay = new StrokeOverlay();

	get isCreated(): boolean {
		return this.#window !== null;
	}

	create(handlers: AiPointerViewHandlers): void {
		if (this.#window) return;
		this.#handlers = handlers;
		createRoot((dispose) => {
			this.#window = (
				<window
					name="ai-pointer"
					namespace="ags-ai-pointer"
					visible={false}
					anchor={Astal.WindowAnchor.NONE}
					layer={Astal.Layer.OVERLAY}
					exclusivity={Astal.Exclusivity.IGNORE}
					keymode={Astal.Keymode.EXCLUSIVE}
					class="ai-pointer"
					application={app}
					$={(self: Astal.Window) => {
						bindGamingOpacity(self);
						const keyController = new Gtk.EventControllerKey();
						keyController.connect("key-pressed", (_controller, keyval: number) => {
							if (keyval !== Gdk.KEY_Escape) return false;
							this.#handlers?.onCancel();
							return true;
						});
						self.add_controller(keyController);
					}}
				>
					<box orientation={Gtk.Orientation.VERTICAL} spacing={12} class="ai-pointer-panel">
						<box orientation={Gtk.Orientation.HORIZONTAL} spacing={8} class="ai-pointer-heading">
							<box class="ai-pointer-signal" />
							<label label="SELECTED REGION" class="ai-pointer-title" halign={Gtk.Align.START} />
						</box>
						<box orientation={Gtk.Orientation.HORIZONTAL} spacing={12} class="ai-pointer-review">
							{this.#createPreview()}
							<box orientation={Gtk.Orientation.VERTICAL} spacing={10} class="ai-pointer-metadata">
								{this.#createMetadataField("PROGRAM", (label) => {
									this.#program = label;
								})}
								{this.#createMetadataField("ACCESSIBLE ELEMENT", (label) => {
									this.#target = label;
								})}
								{this.#createMetadataField("MATCH EVIDENCE", (label) => {
									this.#evidence = label;
								})}
							</box>
						</box>
						<label
							label=""
							class="ai-pointer-geometry"
							halign={Gtk.Align.START}
							$={(self: Gtk.Label) => {
								this.#geometry = self;
							}}
						/>
						<label
							label=""
							class="ai-pointer-status"
							wrap={true}
							xalign={0}
							$={(self: Gtk.Label) => {
								this.#status = self;
							}}
						/>
						<box orientation={Gtk.Orientation.HORIZONTAL} spacing={8} halign={Gtk.Align.END}>
							<button
								canFocus={true}
								class="ai-pointer-discard"
								onClicked={() => this.#handlers?.onCancel()}
								$={(self: Gtk.Button) => configureButton(self, { variant: "default" })}
							>
								<label label="Discard" />
							</button>
							<button sensitive={false} class="ai-pointer-ask">
								<label label="Ask (next slice)" />
							</button>
						</box>
					</box>
				</window>
			) as Astal.Window;
			this.#window.connect("destroy", dispose);
		});
	}

	showCapture(capture: Capture, accessibility: AccessibilityMetadata | null = null): boolean {
		try {
			this.#preview?.set_paintable(
				Gdk.Texture.new_from_file(Gio.File.new_for_path(capture.path)),
			);
		} catch {
			return false;
		}
		this.#geometry?.set_label(
			`${capture.geometry.width} × ${capture.geometry.height} at ${capture.geometry.x}, ${capture.geometry.y}`,
		);
		const target = accessibility
			? `${accessibility.role}${accessibility.name ? `: ${accessibility.name}` : ""}`
			: null;
		const programIdentity = accessibility?.program?.class ?? "Unknown application";
		this.#program?.set_label(
			accessibility?.program
				? `${programIdentity} · PID ${accessibility.program.pid}${accessibility.program.title ? `\n${accessibility.program.title}` : ""}`
				: "No matched program metadata",
		);
		this.#target?.set_label(
			accessibility
				? `${target}${accessibility.targetGeometry
					? `\n${accessibility.targetGeometry.width} × ${accessibility.targetGeometry.height} at ${accessibility.targetGeometry.x}, ${accessibility.targetGeometry.y}`
					: ""}${accessibility.url ? `\n${accessibility.url}` : ""}`
				: "No reliable accessible element",
		);
		this.#evidence?.set_label(
			accessibility
				? `${Math.round(accessibility.confidence * 100)}% confidence · ${accessibility.centerHit ? "center hit" : "fuzzy hit"} · ${accessibility.hitCount ?? 1} sample${(accessibility.hitCount ?? 1) === 1 ? "" : "s"}`
				: "Stroke geometry fallback",
		);
		this.#status?.set_label(
			target
				? `Snapped locally to ${target}. Accessibility metadata stays on this device; AI requests remain disabled.`
				: "No reliable accessible target was found; using the drawn region. AI requests remain disabled.",
		);
		if (this.#strokeOverlay.showSelection(capture.geometry) === false) return false;
		this.#show();
		return true;
	}

	beginStroke(stroke: PointerStroke, onFrame: () => void): boolean {
		return this.#strokeOverlay.show(stroke, () => this.#handlers?.onCancel(), onFrame);
	}

	updateStroke(stroke: PointerStroke): void {
		this.#strokeOverlay.update(stroke);
	}

	endStroke(): void {
		this.#strokeOverlay.hide();
	}

	finishStroke(): Promise<boolean> {
		return this.#strokeOverlay.hideBeforeCapture();
	}

	showError(message: string): void {
		this.#preview?.set_paintable(null);
		this.#geometry?.set_label("");
		this.#status?.set_label(message);
		this.#show();
	}

	hide(): void {
		this.#window?.set_visible(false);
		this.#strokeOverlay.hide();
	}

	dispose(): void {
		this.#strokeOverlay.hide();
		this.#window?.destroy();
		this.#window = null;
		this.#preview = null;
		this.#geometry = null;
		this.#program = null;
		this.#target = null;
		this.#evidence = null;
		this.#status = null;
		this.#handlers = null;
	}

	#show(): void {
		try {
			const monitor = getPointerMonitor();
			if (monitor) this.#window?.set_gdkmonitor(monitor.monitor);
		} catch {
			// A placement lookup must not prevent the reviewed capture from appearing.
		}
		this.#window?.set_visible(true);
	}

	#createPreview(): Gtk.Picture {
		const preview = new Gtk.Picture({
			contentFit: Gtk.ContentFit.CONTAIN,
			canShrink: true,
			widthRequest: 480,
			heightRequest: 270,
		});
		preview.add_css_class("ai-pointer-preview");
		this.#preview = preview;
		return preview;
	}

	#createMetadataField(heading: string, assign: (label: Gtk.Label) => void): Gtk.Box {
		const value = new Gtk.Label({
			halign: Gtk.Align.START,
			selectable: true,
			wrap: true,
			xalign: 0,
		});
		value.add_css_class("ai-pointer-metadata-value");
		assign(value);
		const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 3 });
		const title = new Gtk.Label({ halign: Gtk.Align.START, label: heading, xalign: 0 });
		title.add_css_class("ai-pointer-metadata-title");
		box.append(title);
		box.append(value);
		return box;
	}
}
