import { Astal } from "ags/gtk4";
import app from "ags/gtk4/app";
import { createRoot } from "ags";
import Gdk from "gi://Gdk?version=4.0";
import Gio from "gi://Gio?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import Pango from "gi://Pango?version=1.0";
import { bindGamingOpacity } from "@/services/gaming-opacity";
import { getPointerMonitor } from "@/services/pointer-monitor";
import type { Capture } from "./capture";
import type { OcrResult } from "./ocr";
import { promptPosition } from "./selection";
import type { PointerStroke } from "./stroke";
import { StrokeOverlay } from "./stroke-overlay";

const promptMinimumWidth = 40;
const promptMaximumWidth = 348;
const promptHostWidth = 400;
const promptHostHeight = 56;
const allEdges =
	Astal.WindowAnchor.TOP |
	Astal.WindowAnchor.BOTTOM |
	Astal.WindowAnchor.LEFT |
	Astal.WindowAnchor.RIGHT;

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
	#promptCanvas: Gtk.Fixed | null = null;
	#promptHost: Gtk.CenterBox | null = null;
	#prompt: Gtk.Entry | null = null;
	#capture: Capture | null = null;
	#handlers: AiPointerViewHandlers | null = null;
	readonly #strokeOverlay = new StrokeOverlay();

	get isCreated(): boolean {
		return this.#window !== null;
	}

	get isPromptVisible(): boolean {
		return this.#window?.get_visible() ?? false;
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
					anchor={allEdges}
					layer={Astal.Layer.OVERLAY}
					exclusivity={Astal.Exclusivity.IGNORE}
					keymode={Astal.Keymode.EXCLUSIVE}
					class="ai-pointer ai-pointer-prompt-surface"
					application={app}
					$={(self: Astal.Window) => {
						bindGamingOpacity(self);
						self.add_controller(this.#createCancelController());

						const canvas = new Gtk.Fixed({ hexpand: true, vexpand: true });
						const host = new Gtk.CenterBox({
							width_request: promptHostWidth,
							height_request: promptHostHeight,
						});
						host.add_css_class("ai-pointer-prompt-host");
						const panel = new Gtk.Box({ valign: Gtk.Align.CENTER });
						panel.add_css_class("ai-pointer-prompt-panel");
						const prompt = new Gtk.Entry();
						prompt.add_css_class("ai-pointer-prompt-input");
						prompt.add_controller(this.#createCancelController());
						prompt.connect("notify::text", () => this.#resizePrompt());
						panel.append(prompt);
						host.set_center_widget(panel);
						canvas.put(host, 0, 0);
						self.set_child(canvas);

						this.#promptCanvas = canvas;
						this.#promptHost = host;
						this.#prompt = prompt;
						this.#resizePrompt();
					}}
				/>
			) as Astal.Window;
			this.#window.connect("destroy", dispose);
		});
	}

	showCapture(capture: Capture): CapturePreview | null {
		let texture: Gdk.Texture;
		try {
			texture = Gdk.Texture.new_from_file(Gio.File.new_for_path(capture.path));
		} catch {
			return null;
		}
		if (this.#strokeOverlay.showSelection(capture.geometry) === false) return null;
		this.#capture = capture;
		this.#prompt?.set_text("");
		this.#resizePrompt();
		this.#showAt(capture);
		return { pixelHeight: texture.get_height(), pixelWidth: texture.get_width() };
	}

	setOcrState(_state: OcrViewState): void {}

	clearOcr(): void {}

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
		this.#prompt?.set_text(message);
		this.#resizePrompt();
		this.#show();
	}

	hide(): void {
		this.clearOcr();
		this.#capture = null;
		this.#window?.set_visible(false);
		this.#strokeOverlay.hide();
	}

	dispose(): void {
		this.#strokeOverlay.hide();
		this.#window?.destroy();
		this.#window = null;
		this.#promptCanvas = null;
		this.#promptHost = null;
		this.#prompt = null;
		this.#capture = null;
		this.#handlers = null;
	}

	#createCancelController(): Gtk.EventControllerKey {
		const controller = new Gtk.EventControllerKey();
		controller.connect("key-pressed", (_controller, keyval: number) => {
			if (keyval !== Gdk.KEY_Escape) return false;
			this.#handlers?.onCancel();
			return true;
		});
		return controller;
	}

	#resizePrompt(): void {
		const prompt = this.#prompt;
		if (!prompt) return;
		const layout = Pango.Layout.new(prompt.get_pango_context());
		layout.set_text(prompt.get_text(), -1);
		const [textWidth] = layout.get_pixel_size();
		const width = Math.min(Math.max(textWidth, promptMinimumWidth), promptMaximumWidth);
		prompt.set_size_request(width, -1);
	}

	#showAt(capture: Capture): void {
		this.#capture = capture;
		if (this.#positionPrompt() === false) {
			this.#show();
			return;
		}
		this.#window?.set_visible(true);
		this.#prompt?.grab_focus();
	}

	#positionPrompt(): boolean {
		const capture = this.#capture;
		if (!capture) return false;
		const display = Gdk.Display.get_default();
		const monitors = display?.get_monitors();
		const centerX = capture.geometry.x + capture.geometry.width / 2;
		const centerY = capture.geometry.y + capture.geometry.height / 2;
		for (let index = 0; monitors && index < monitors.get_n_items(); index += 1) {
			const monitor = monitors.get_item(index) as Gdk.Monitor | null;
			if (!monitor) continue;
			const bounds = monitor.get_geometry();
			if (
				centerX < bounds.x ||
				centerX >= bounds.x + bounds.width ||
				centerY < bounds.y ||
				centerY >= bounds.y + bounds.height
			)
				continue;
			const position = promptPosition(capture.geometry, bounds, {
				width: promptHostWidth,
				height: promptHostHeight,
			});
			this.#window?.set_gdkmonitor(monitor);
			if (this.#promptCanvas && this.#promptHost)
				this.#promptCanvas.move(
					this.#promptHost,
					position.x - bounds.x,
					position.y - bounds.y,
				);
			return true;
		}
		return false;
	}

	#show(): void {
		try {
			const monitor = getPointerMonitor();
			if (monitor) this.#window?.set_gdkmonitor(monitor.monitor);
		} catch {
			// A placement lookup must not prevent the prompt from appearing.
		}
		this.#window?.set_visible(true);
		this.#prompt?.grab_focus();
	}
}
