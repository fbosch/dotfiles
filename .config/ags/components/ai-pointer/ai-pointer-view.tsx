import { Astal } from "ags/gtk4";
import app from "ags/gtk4/app";
import { createRoot } from "ags";
import Gdk from "gi://Gdk?version=4.0";
import Gio from "gi://Gio?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import Pango from "gi://Pango?version=1.0";
import { configureButton } from "@/components/button";
import { bindGamingOpacity } from "@/services/gaming-opacity";
import { getPointerMonitor } from "@/services/pointer-monitor";
import type { AccessibilityMetadata, ProgramMetadata } from "./accessibility-policy";
import type { Capture } from "./capture";
import type { OcrResult } from "./ocr";
import type { PointerStroke } from "./stroke";
import { StrokeOverlay } from "./stroke-overlay";

export interface AiPointerViewHandlers {
	onCancel(): void;
}

export interface CapturePreview {
	pixelHeight: number;
	pixelWidth: number;
}

export type OcrViewState = Exclude<OcrResult, { kind: "cancelled" }> | { kind: "pending" };

export class AiPointerView {
	#window: Astal.Window | null = null;
	#preview: Gtk.Picture | null = null;
	#geometry: Gtk.Label | null = null;
	#program: Gtk.Label | null = null;
	#target: Gtk.Label | null = null;
	#evidence: Gtk.Label | null = null;
	#ocr: Gtk.Label | null = null;
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
								{this.#createOcrField()}
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

	showCapture(
		capture: Capture,
		accessibility: AccessibilityMetadata | null = null,
		program: ProgramMetadata | null = accessibility?.program ?? null,
	): CapturePreview | null {
		let texture: Gdk.Texture;
		try {
			texture = Gdk.Texture.new_from_file(Gio.File.new_for_path(capture.path));
			this.#preview?.set_paintable(texture);
		} catch {
			return null;
		}
		this.#geometry?.set_label(
			`${capture.geometry.width} × ${capture.geometry.height} at ${capture.geometry.x}, ${capture.geometry.y}`,
		);
		const target = this.#formatTarget(accessibility);
		const programIdentity = program?.class ?? "Unknown application";
		this.#program?.set_label(
			program
				? `${programIdentity} · PID ${program.pid}${program.title ? `\n${program.title}` : ""}\n${program.geometry.width} × ${program.geometry.height} at ${program.geometry.x}, ${program.geometry.y}`
				: "No matched program metadata",
		);
		this.#target?.set_label(target ?? "No reliable accessible element");
		this.#evidence?.set_label(this.#formatEvidence(accessibility));
		this.#status?.set_label(
			target
				? `Snapped locally to ${target}. Accessibility metadata stays on this device; AI requests remain disabled.`
				: "No reliable accessible target was found; using the drawn region. AI requests remain disabled.",
		);
		if (this.#strokeOverlay.showSelection(capture.geometry) === false) return null;
		this.#show();
		return { pixelHeight: texture.get_height(), pixelWidth: texture.get_width() };
	}

	setOcrState(state: OcrViewState): void {
		if (!this.#ocr) return;
		if (state.kind === "pending") {
			this.#ocr.set_label("Reading text locally...");
			return;
		}
		if (state.kind === "text") {
			this.#ocr.set_label(state.text);
			return;
		}
		if (state.kind === "truncated") {
			this.#ocr.set_label(`OCR output truncated at 64 KiB.\n\n${state.text}`);
			return;
		}
		if (state.kind === "no-text") {
			this.#ocr.set_label("No text detected.");
			return;
		}
		const messages: Record<string, string> = {
			"executable-missing": "OCR unavailable: Tesseract is not installed.",
			"image-too-large": "OCR unavailable: image exceeds the 6 MP limit.",
			timeout: "OCR unavailable: extraction exceeded 10 seconds.",
		};
		this.#ocr.set_label(messages[state.reason] ?? "OCR unavailable for this image.");
	}

	clearOcr(): void {
		this.#ocr?.set_label("");
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
		this.clearOcr();
		this.#preview?.set_paintable(null);
		this.#geometry?.set_label("");
		this.#status?.set_label(message);
		this.#show();
	}

	hide(): void {
		this.clearOcr();
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
		this.#ocr = null;
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

	#createOcrField(): Gtk.Box {
		const value = new Gtk.Label({
			halign: Gtk.Align.FILL,
			selectable: true,
			valign: Gtk.Align.START,
			wrap: true,
			xalign: 0,
		});
		value.set_wrap_mode(Pango.WrapMode.CHAR);
		value.add_css_class("ai-pointer-metadata-value");
		this.#ocr = value;
		const scroll = new Gtk.ScrolledWindow({
			hscrollbarPolicy: Gtk.PolicyType.NEVER,
			vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
		});
		scroll.add_css_class("ai-pointer-ocr-scroll");
		scroll.set_min_content_height(96);
		scroll.set_max_content_height(160);
		scroll.set_propagate_natural_height(true);
		scroll.set_child(value);
		const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 3 });
		const title = new Gtk.Label({ halign: Gtk.Align.START, label: "LOCAL OCR", xalign: 0 });
		title.add_css_class("ai-pointer-metadata-title");
		box.append(title);
		box.append(scroll);
		return box;
	}

	#formatTarget(accessibility: AccessibilityMetadata | null): string | null {
		if (!accessibility) return null;
		if (accessibility.targets && accessibility.targets.length > 1)
			return `${accessibility.targets.length} matched elements\n${accessibility.targets
				.map(({ name, role, targetGeometry, url }, index) =>
					`${index + 1}. ${role}${name ? `: ${name}` : ""} · ${targetGeometry.width} × ${targetGeometry.height} at ${targetGeometry.x}, ${targetGeometry.y}${url ? `\n   ${url}` : ""}`,
				)
				.join("\n")}`;
		let target = `${accessibility.role}${accessibility.name ? `: ${accessibility.name}` : ""}`;
		if (accessibility.targetGeometry)
			target += `\n${accessibility.targetGeometry.width} × ${accessibility.targetGeometry.height} at ${accessibility.targetGeometry.x}, ${accessibility.targetGeometry.y}`;
		if (accessibility.url) target += `\n${accessibility.url}`;
		return target;
	}

	#formatEvidence(accessibility: AccessibilityMetadata | null): string {
		if (!accessibility) return "Stroke geometry fallback";
		const hitCount = accessibility.hitCount ?? 1;
		let matchKind = "fuzzy hit";
		if (accessibility.targets && accessibility.targets.length > 1) matchKind = "collection";
		else if (accessibility.centerHit) matchKind = "center hit";
		return `${Math.round(accessibility.confidence * 100)}% confidence · ${matchKind} · ${hitCount} sample${hitCount === 1 ? "" : "s"}`;
	}
}
