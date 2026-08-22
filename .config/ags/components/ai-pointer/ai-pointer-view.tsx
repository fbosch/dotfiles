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
const promptHostWidth = 520;
const promptHostHeight = 620;
const allEdges =
	Astal.WindowAnchor.TOP |
	Astal.WindowAnchor.BOTTOM |
	Astal.WindowAnchor.LEFT |
	Astal.WindowAnchor.RIGHT;

export interface AiPointerViewHandlers {
	onCancel(): void;
	onSubmit(question: string): void;
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
	#preview: Gtk.Picture | null = null;
	#context: Gtk.Label | null = null;
	#status: Gtk.Label | null = null;
	#answer: Gtk.Label | null = null;
	#answerScroll: Gtk.ScrolledWindow | null = null;
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
						const panel = new Gtk.Box({
							orientation: Gtk.Orientation.VERTICAL,
							spacing: 12,
							valign: Gtk.Align.CENTER,
						});
						panel.add_css_class("ai-pointer-prompt-panel");
						const preview = new Gtk.Picture({
							contentFit: Gtk.ContentFit.CONTAIN,
							canShrink: true,
							heightRequest: 220,
						});
						preview.add_css_class("ai-pointer-preview");
						const context = new Gtk.Label({
							wrap: true,
							xalign: 0,
							selectable: false,
						});
						context.add_css_class("ai-pointer-context");
						const disclosure = new Gtk.Label({
							label: "Press Enter to send this image, question, and context to the configured model provider. Provider-side deletion is not guaranteed.",
							wrap: true,
							xalign: 0,
							selectable: false,
						});
						disclosure.add_css_class("ai-pointer-disclosure");
						const prompt = new Gtk.Entry();
						prompt.add_css_class("ai-pointer-prompt-input");
						prompt.set_placeholder_text("Ask about this selection");
						prompt.add_controller(this.#createCancelController());
						prompt.connect("notify::text", () => this.#resizePrompt());
						prompt.connect("activate", () => {
							const question = prompt.get_text().trim();
							if (question) this.#handlers?.onSubmit(question);
						});
						const status = new Gtk.Label({ wrap: true, xalign: 0, selectable: false });
						status.add_css_class("ai-pointer-status");
						const answer = new Gtk.Label({
							wrap: true,
							wrapMode: Pango.WrapMode.WORD_CHAR,
							xalign: 0,
							yalign: 0,
							selectable: false,
						});
						answer.set_use_markup(false);
						answer.add_css_class("ai-pointer-answer");
						const answerScroll = new Gtk.ScrolledWindow({
							heightRequest: 150,
							propagateNaturalHeight: true,
							visible: false,
						});
						answerScroll.add_css_class("ai-pointer-answer-scroll");
						answerScroll.set_child(answer);
						panel.append(preview);
						panel.append(context);
						panel.append(disclosure);
						panel.append(prompt);
						panel.append(status);
						panel.append(answerScroll);
						host.set_center_widget(panel);
						canvas.put(host, 0, 0);
						self.set_child(canvas);

						this.#promptCanvas = canvas;
						this.#promptHost = host;
						this.#prompt = prompt;
						this.#preview = preview;
						this.#context = context;
						this.#status = status;
						this.#answer = answer;
						this.#answerScroll = answerScroll;
						this.#resizePrompt();
					}}
				/>
			) as Astal.Window;
			this.#window.connect("destroy", dispose);
		});
	}

	showCapture(capture: Capture, context: string): CapturePreview | null {
		let texture: Gdk.Texture;
		try {
			texture = Gdk.Texture.new_from_file(Gio.File.new_for_path(capture.path));
		} catch {
			return null;
		}
		if (this.#strokeOverlay.showSelection(capture.geometry) === false) return null;
		this.#capture = capture;
		this.#preview?.set_paintable(texture);
		this.#context?.set_label(context);
		this.#status?.set_label("");
		this.#answer?.set_label("");
		this.#answerScroll?.set_visible(false);
		this.#prompt?.set_text("");
		this.#prompt?.set_sensitive(true);
		this.#resizePrompt();
		this.#showAt(capture);
		return { pixelHeight: texture.get_height(), pixelWidth: texture.get_width() };
	}

	showRequesting(): void {
		this.#prompt?.set_sensitive(false);
		this.#status?.set_label("Asking the configured model provider...");
		this.#answer?.set_label("");
		this.#answerScroll?.set_visible(false);
	}

	showAnswer(answer: string, truncated: boolean): void {
		this.#prompt?.set_sensitive(false);
		this.#status?.set_label(truncated ? "Answer truncated to the local response limit." : "Answer");
		this.#answer?.set_label(answer);
		this.#answerScroll?.set_visible(true);
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
		this.#prompt?.set_sensitive(false);
		this.#status?.set_label(message);
		this.#answer?.set_label("");
		this.#answerScroll?.set_visible(false);
		this.#show();
	}

	hide(): void {
		this.clearOcr();
		this.#capture = null;
		this.#preview?.set_paintable(null);
		this.#window?.set_visible(false);
		this.#strokeOverlay.hide();
	}

	dispose(): void {
		this.hide();
		const window = this.#window;
		this.#window = null;
		this.#promptCanvas = null;
		this.#promptHost = null;
		this.#prompt = null;
		this.#preview = null;
		this.#context = null;
		this.#status = null;
		this.#answer = null;
		this.#answerScroll = null;
		this.#capture = null;
		this.#handlers = null;
		window?.destroy();
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
			const hostWidth = Math.min(promptHostWidth, Math.max(1, bounds.width - 32));
			const hostHeight = Math.min(promptHostHeight, Math.max(1, bounds.height - 32));
			this.#promptHost?.set_size_request(hostWidth, hostHeight);
			const position = promptPosition(capture.geometry, bounds, {
				width: hostWidth,
				height: hostHeight,
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
