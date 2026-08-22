import { Astal } from "ags/gtk4";
import app from "ags/gtk4/app";
import { createRoot } from "ags";
import Cairo from "cairo";
import Gdk from "gi://Gdk?version=4.0";
import Gio from "gi://Gio?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import Pango from "gi://Pango?version=1.0";
import { configureButton, setButtonVariant } from "@/components/button";
import { bindGamingOpacity } from "@/services/gaming-opacity";
import { getPointerMonitor } from "@/services/pointer-monitor";
import type { Capture } from "./capture";
import { createCancelController } from "./cancel-controller";
import type { OcrResult } from "./ocr";
import { promptPosition, type SelectionGeometry } from "./selection";
import type { PointerStroke } from "./stroke";
import { StrokeOverlay } from "./stroke-overlay";

const promptMinimumWidth = 160;
const promptMaximumWidth = 348;
const promptHorizontalChrome = 58;
const promptHostHeight = 50;
const allEdges =
	Astal.WindowAnchor.TOP |
	Astal.WindowAnchor.BOTTOM |
	Astal.WindowAnchor.LEFT |
	Astal.WindowAnchor.RIGHT;

type ActionMode = "preparing" | "compose" | "requesting" | "close";

export interface AiPointerViewHandlers {
	onCancel(): void;
	onSubmit(question: string): void;
}

export interface CaptureDimensions {
	pixelHeight: number;
	pixelWidth: number;
}

export type OcrViewState = Exclude<OcrResult, { kind: "cancelled" }> | { kind: "pending" };

export class AiPointerView {
	#window: Astal.Window | null = null;
	#promptCanvas: Gtk.Fixed | null = null;
	#promptHost: Gtk.CenterBox | null = null;
	#prompt: Gtk.Entry | null = null;
	#actionButton: Gtk.Button | null = null;
	#promptPill: Gtk.Box | null = null;
	#sendIcon: Gtk.Widget | null = null;
	#spinner: Gtk.Spinner | null = null;
	#cancelIcon: Gtk.Widget | null = null;
	#answer: Gtk.Label | null = null;
	#truncated: Gtk.Label | null = null;
	#answerScroll: Gtk.ScrolledWindow | null = null;
	#error: Gtk.Label | null = null;
	#errorBox: Gtk.Box | null = null;
	#selection: SelectionGeometry | null = null;
	#handlers: AiPointerViewHandlers | null = null;
	#actionMode: ActionMode = "compose";
	readonly #strokeOverlay = new StrokeOverlay();
	readonly #selectionOverlay = new StrokeOverlay();

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
						self.add_controller(createCancelController(() => this.#handlers?.onCancel()));

						const canvas = new Gtk.Fixed({ hexpand: true, vexpand: true });
						const host = new Gtk.CenterBox({
							widthRequest: promptMinimumWidth + promptHorizontalChrome,
							heightRequest: promptHostHeight,
						});
						host.add_css_class("ai-pointer-prompt-host");
						const panel = new Gtk.Box({
							orientation: Gtk.Orientation.VERTICAL,
							spacing: 8,
							valign: Gtk.Align.CENTER,
						});
						panel.add_css_class("ai-pointer-prompt-panel");

						const promptPill = new Gtk.Box({
							orientation: Gtk.Orientation.HORIZONTAL,
							spacing: 8,
							halign: Gtk.Align.START,
						});
						promptPill.add_css_class("ai-pointer-prompt-pill");
						const prompt = new Gtk.Entry();
						prompt.add_css_class("ai-pointer-prompt-input");
						prompt.set_placeholder_text("Ask about this...");
						prompt.add_controller(createCancelController(() => this.#handlers?.onCancel()));
						prompt.connect("notify::has-focus", () => {
							if (prompt.has_focus) promptPill.add_css_class("focused");
							else promptPill.remove_css_class("focused");
						});
						prompt.connect("notify::text", () => {
							this.#resizePrompt();
							if (this.#actionMode === "compose")
								this.#actionButton?.set_sensitive(prompt.get_text().trim().length > 0);
						});
						prompt.connect("activate", () => this.#submit());

						const sendIcon = createSendIcon();
						const spinner = new Gtk.Spinner({
							halign: Gtk.Align.CENTER,
							valign: Gtk.Align.CENTER,
						});
						spinner.add_css_class("ai-pointer-spinner");
						const cancelIcon = createCloseIcon();
						const actionContent = new Gtk.Overlay({ widthRequest: 32, heightRequest: 32 });
						actionContent.set_child(sendIcon);
						actionContent.add_overlay(spinner);
						actionContent.add_overlay(cancelIcon);
						const actionButton = new Gtk.Button({
							canFocus: true,
							child: actionContent,
							valign: Gtk.Align.CENTER,
						});
						configureButton(actionButton, {
							variant: "primary",
							className: "ai-pointer-action",
							onClick: () => this.#activateAction(),
						});
						promptPill.append(prompt);
						promptPill.append(actionButton);

						const answer = new Gtk.Label({
							wrap: true,
							wrapMode: Pango.WrapMode.WORD_CHAR,
							xalign: 0,
							yalign: 0,
							selectable: false,
						});
						answer.set_use_markup(false);
						answer.add_css_class("ai-pointer-answer");
						const truncated = new Gtk.Label({
							label: "Answer truncated to the local limit",
							xalign: 0,
							visible: false,
						});
						truncated.add_css_class("ai-pointer-truncated");
						const answerBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 });
						answerBox.append(answer);
						answerBox.append(truncated);
						const answerScroll = new Gtk.ScrolledWindow({
							maxContentHeight: 256,
							propagateNaturalHeight: true,
							widthRequest: 416,
							visible: false,
						});
						answerScroll.add_css_class("ai-pointer-answer-scroll");
						answerScroll.set_child(answerBox);

						const error = new Gtk.Label({ wrap: true, xalign: 0, selectable: false });
						error.add_css_class("ai-pointer-error");
						const errorIcon = new Gtk.Label({ label: "!", valign: Gtk.Align.START });
						errorIcon.add_css_class("ai-pointer-error-icon");
						const errorBox = new Gtk.Box({
							orientation: Gtk.Orientation.HORIZONTAL,
							spacing: 8,
							widthRequest: 416,
							visible: false,
						});
						errorBox.add_css_class("ai-pointer-error-box");
						errorBox.append(errorIcon);
						errorBox.append(error);

						panel.append(promptPill);
						panel.append(answerScroll);
						panel.append(errorBox);
						host.set_center_widget(panel);
						canvas.put(host, 0, 0);
						self.set_child(canvas);

						this.#promptCanvas = canvas;
						this.#promptHost = host;
						this.#prompt = prompt;
						this.#promptPill = promptPill;
						this.#actionButton = actionButton;
						this.#sendIcon = sendIcon;
						this.#spinner = spinner;
						this.#cancelIcon = cancelIcon;
						this.#answer = answer;
						this.#truncated = truncated;
						this.#answerScroll = answerScroll;
						this.#error = error;
						this.#errorBox = errorBox;
						this.#setActionMode("compose");
						this.#resizePrompt();
					}}
				/>
			) as Astal.Window;
			this.#window.connect("destroy", dispose);
		});
	}

	showPrompt(capture: Capture): CaptureDimensions | null {
		let texture: Gdk.Texture;
		try {
			texture = Gdk.Texture.new_from_file(Gio.File.new_for_path(capture.path));
		} catch {
			return null;
		}
		const geometryChanged = selectionEquals(this.#selection, capture.geometry) === false;
		this.#selection = capture.geometry;
		this.#answer?.set_label("");
		this.#answerScroll?.set_visible(false);
		this.#error?.set_label("");
		this.#errorBox?.set_visible(false);
		this.#promptPill?.remove_css_class("error");
		this.#prompt?.set_sensitive(true);
		this.#setActionMode("compose");
		this.#resizePrompt();
		this.#showAt(capture.geometry);
		if (geometryChanged) this.#selectionOverlay.showSelection(capture.geometry, true);
		else this.#selectionOverlay.setSelectionFill(true);
		return { pixelHeight: texture.get_height(), pixelWidth: texture.get_width() };
	}

	showPreparing(selection: SelectionGeometry): void {
		this.#selection = selection;
		this.#answer?.set_label("");
		this.#answerScroll?.set_visible(false);
		this.#error?.set_label("");
		this.#errorBox?.set_visible(false);
		this.#promptPill?.remove_css_class("error");
		this.#prompt?.set_text("");
		this.#prompt?.set_sensitive(true);
		this.#setActionMode("preparing");
		this.#resizePrompt();
		this.#showAt(selection);
	}

	showRequesting(): void {
		this.#prompt?.set_sensitive(false);
		this.#answer?.set_label("");
		this.#answerScroll?.set_visible(false);
		this.#errorBox?.set_visible(false);
		this.#promptPill?.remove_css_class("error");
		this.#setActionMode("requesting");
	}

	showPartialAnswer(answer: string): void {
		this.#answer?.set_label(answer);
		this.#truncated?.set_visible(false);
		this.#answerScroll?.set_visible(answer.length > 0);
	}

	showAnswer(answer: string, truncated: boolean): void {
		this.#selectionOverlay.hide();
		this.#prompt?.set_sensitive(false);
		this.#answer?.set_label(answer);
		this.#truncated?.set_visible(truncated);
		this.#answerScroll?.set_visible(true);
		this.#errorBox?.set_visible(false);
		this.#promptPill?.remove_css_class("error");
		this.#setActionMode("close");
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
		this.#selectionOverlay.hide();
	}

	finishStroke(selection: SelectionGeometry): Promise<boolean> {
		if (this.#selectionOverlay.showSelection(selection) === false) return Promise.resolve(false);
		this.#selection = selection;
		return this.#strokeOverlay.hideBeforeCapture();
	}

	showError(message: string): void {
		this.clearOcr();
		this.#prompt?.set_sensitive(false);
		this.showPartialAnswer("");
		this.#error?.set_label(message);
		this.#errorBox?.set_visible(true);
		this.#promptPill?.add_css_class("error");
		this.#setActionMode("close");
		this.#show();
	}

	hide(): void {
		this.clearOcr();
		this.#selection = null;
		this.#window?.set_visible(false);
		this.#strokeOverlay.hide();
		this.#selectionOverlay.hide();
	}

	dispose(): void {
		this.hide();
		const window = this.#window;
		this.#window = null;
		this.#promptCanvas = null;
		this.#promptHost = null;
		this.#prompt = null;
		this.#promptPill = null;
		this.#actionButton = null;
		this.#sendIcon = null;
		this.#spinner = null;
		this.#cancelIcon = null;
		this.#answer = null;
		this.#truncated = null;
		this.#answerScroll = null;
		this.#error = null;
		this.#errorBox = null;
		this.#selection = null;
		this.#handlers = null;
		window?.destroy();
	}

	#activateAction(): void {
		if (this.#actionMode === "compose") {
			this.#submit();
			return;
		}
		this.#handlers?.onCancel();
	}

	#submit(): void {
		const question = this.#prompt?.get_text().trim() ?? "";
		if (this.#actionMode === "compose" && question) this.#handlers?.onSubmit(question);
	}

	#setActionMode(mode: ActionMode): void {
		this.#actionMode = mode;
		this.#actionButton?.remove_css_class("requesting");
		this.#sendIcon?.set_visible(mode === "compose" || mode === "preparing");
		this.#spinner?.set_visible(mode === "requesting");
		this.#cancelIcon?.set_visible(mode === "requesting" || mode === "close");
		if (mode === "requesting") {
			this.#actionButton?.add_css_class("requesting");
			this.#spinner?.start();
		} else {
			this.#spinner?.stop();
		}
		if (!this.#actionButton) return;
		setButtonVariant(this.#actionButton, mode === "close" ? "transparent" : "primary");
		const label =
			mode === "compose" || mode === "preparing"
				? "Send question"
				: mode === "requesting"
					? "Cancel request"
					: "Close AI Pointer";
		this.#actionButton.set_tooltip_text(label);
		this.#actionButton.update_property([Gtk.AccessibleProperty.LABEL], [label]);
		this.#actionButton.set_sensitive(
			mode !== "preparing" &&
				(mode !== "compose" || (this.#prompt?.get_text().trim().length ?? 0) > 0),
		);
	}

	#resizePrompt(): void {
		const prompt = this.#prompt;
		if (!prompt) return;
		const layout = Pango.Layout.new(prompt.get_pango_context());
		layout.set_text(prompt.get_text(), -1);
		const [textWidth] = layout.get_pixel_size();
		const inputWidth = Math.min(Math.max(textWidth, promptMinimumWidth), promptMaximumWidth);
		prompt.set_size_request(inputWidth, -1);
		this.#promptHost?.set_size_request(inputWidth + promptHorizontalChrome, promptHostHeight);
		if (this.isPromptVisible) this.#positionPrompt();
	}

	#showAt(selection: SelectionGeometry): void {
		this.#selection = selection;
		if (this.#positionPrompt() === false) {
			this.#show();
			return;
		}
		this.#window?.set_visible(true);
		this.#prompt?.grab_focus();
	}

	#positionPrompt(): boolean {
		const selection = this.#selection;
		if (!selection) return false;
		const display = Gdk.Display.get_default();
		const monitors = display?.get_monitors();
		const centerX = selection.x + selection.width / 2;
		const centerY = selection.y + selection.height / 2;
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
			const hostWidth = Math.min(
				this.#promptHost?.widthRequest ?? promptMinimumWidth + promptHorizontalChrome,
				Math.max(1, bounds.width - 32),
			);
			const hostHeight = Math.min(promptHostHeight, Math.max(1, bounds.height - 32));
			this.#promptHost?.set_size_request(hostWidth, hostHeight);
			const position = promptPosition(selection, bounds, { width: hostWidth, height: hostHeight });
			this.#window?.set_gdkmonitor(monitor);
			if (this.#promptCanvas && this.#promptHost)
				this.#promptCanvas.move(this.#promptHost, position.x - bounds.x, position.y - bounds.y);
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

function selectionEquals(
	left: SelectionGeometry | null,
	right: SelectionGeometry,
): boolean {
	return (
		left?.x === right.x &&
		left.y === right.y &&
		left.width === right.width &&
		left.height === right.height
	);
}

function createSendIcon(): Gtk.DrawingArea {
	const icon = new Gtk.DrawingArea({ widthRequest: 15, heightRequest: 15 });
	icon.add_css_class("ai-pointer-send-icon");
	icon.set_draw_func((area, cr: any) => {
		setIconStroke(area, cr);
		cr.translate((area.get_width() - 15) / 2, (area.get_height() - 15) / 2);
		cr.moveTo(3, 7.5);
		cr.lineTo(11, 7.5);
		cr.moveTo(7.75, 3.75);
		cr.lineTo(11.5, 7.5);
		cr.lineTo(7.75, 11.25);
		cr.stroke();
	});
	return icon;
}

function createCloseIcon(): Gtk.DrawingArea {
	const icon = new Gtk.DrawingArea({ widthRequest: 13, heightRequest: 13 });
	icon.add_css_class("ai-pointer-cancel-icon");
	icon.set_draw_func((area, cr: any) => {
		setIconStroke(area, cr);
		cr.translate((area.get_width() - 13) / 2, (area.get_height() - 13) / 2);
		cr.moveTo(3, 3);
		cr.lineTo(10, 10);
		cr.moveTo(10, 3);
		cr.lineTo(3, 10);
		cr.stroke();
	});
	return icon;
}

function setIconStroke(area: Gtk.DrawingArea, cr: any): void {
	const color = area.get_style_context().get_color();
	cr.setSourceRGBA(color.red, color.green, color.blue, color.alpha);
	cr.setLineWidth(1.5);
	cr.setLineCap(Cairo.LineCap.ROUND);
	cr.setLineJoin(Cairo.LineJoin.ROUND);
}
