import app from "ags/gtk4/app";
import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import { AiPointerView } from "@/components/ai-pointer/ai-pointer-view";
import { assert, test } from "./harness";

function settleMainLoop(delay = 1): Promise<void> {
	return new Promise((resolve) => {
		GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
			resolve();
			return GLib.SOURCE_REMOVE;
		});
	});
}

function findWidgetWithClass(widget: Gtk.Widget, className: string): Gtk.Widget | null {
	if (widget.has_css_class(className)) return widget;
	let child = widget.get_first_child();
	while (child) {
		const match = findWidgetWithClass(child, className);
		if (match) return match;
		child = child.get_next_sibling();
	}
	return null;
}

test("AI Pointer view presents a question prompt and disposes", async () => {
	const view = new AiPointerView();
	let cancelled = 0;
	let submitted = "";
	view.create({
		onCancel() {
			cancelled += 1;
		},
		onSubmit(question) {
			submitted = question;
		},
	});
	const capturePath = GLib.canonicalize_filename(
		"../../../components/ai-pointer/__tests__/capture.svg",
		GLib.get_current_dir(),
	);
	const monitor = Gdk.Display.get_default()?.get_monitors().get_item(0) as Gdk.Monitor | null;
	assert(monitor !== null, "AI Pointer view test requires a monitor");
	const bounds = monitor.get_geometry();
	const geometry = {
		x: bounds.x + bounds.width - 30,
		y: bounds.y + bounds.height - 30,
		width: 20,
		height: 20,
	};
	view.showPreparing(geometry);
	await settleMainLoop(50);
	assert(view.isCreated, "AI Pointer view was not created");
	assert(view.isPromptVisible, "AI Pointer prompt was not shown");
	const window = app.get_window("ai-pointer");
	assert(window !== null, "AI Pointer window was not registered");
	const prompt = findWidgetWithClass(window, "ai-pointer-prompt-input");
	const action = findWidgetWithClass(window, "ai-pointer-action");
	const pill = findWidgetWithClass(window, "ai-pointer-prompt-pill");
	const host = findWidgetWithClass(window, "ai-pointer-prompt-host");
	const answer = findWidgetWithClass(window, "ai-pointer-answer");
	const answerScroll = findWidgetWithClass(window, "ai-pointer-answer-scroll");
	assert(prompt instanceof Gtk.Entry, "AI Pointer question input was not rendered");
	assert(action instanceof Gtk.Button, "AI Pointer action was not rendered");
	assert(pill instanceof Gtk.Box, "AI Pointer pill was not rendered");
	assert(host instanceof Gtk.Box, "AI Pointer prompt host was not rendered");
	assert(answer instanceof Gtk.Label, "AI Pointer answer label was not rendered");
	assert(answerScroll instanceof Gtk.ScrolledWindow, "AI Pointer answer container was not rendered");
	assert(pill.get_height() <= 50, "AI Pointer pill exceeded the design-system height");
	assert(
		action.get_width() === 32 && action.get_height() === 32,
		`AI Pointer action was ${action.get_width()}x${action.get_height()} instead of 32x32`,
	);
	assert(action.get_sensitive() === false, "empty AI Pointer question was submittable");
	prompt.set_text(`  ${"question ".repeat(80)}  `);
	assert(prompt.widthRequest === 348, "AI Pointer question did not grow to its width bound");
	assert(action.get_sensitive() === false, "question was submittable before capture completed");
	assert(await view.finishStroke(geometry), "AI Pointer selection preview was unavailable");
	assert(
		view.showPrompt({ path: capturePath, geometry, sha256: "a".repeat(64) }),
		"AI Pointer question prompt was rejected",
	);
	assert(prompt.get_text().includes("question"), "capture completion cleared the prepared question");
	assert(action.get_sensitive(), "non-empty AI Pointer question was not submittable");
	const submittedQuestion = "keep this question long enough to widen the prompt ".repeat(8);
	prompt.set_text(submittedQuestion);
	assert(
		view.showPrompt({ path: capturePath, geometry, sha256: "a".repeat(64) }),
		"AI Pointer repeated prompt update was rejected",
	);
	assert(prompt.get_text() === submittedQuestion, "a repeated component update cleared the question");
	await settleMainLoop();
	assert(view.isSelectionPreviewVisible, "AI Pointer selection preview was not visible");
	action.emit("clicked");
	assert(submitted === submittedQuestion.trim(), "AI Pointer submitted the wrong question");
	view.showRequesting();
	assert(
		view.isSelectionPreviewVisible === false,
		"AI Pointer selection preview survived request submission",
	);
	assert(action.has_css_class("requesting"), "AI Pointer requesting action was not presented");
	view.showPartialAnswer("Short answer");
	await settleMainLoop(50);
	const [promptPositionResolved, promptLeft, promptTop] = pill.translate_coordinates(window, 0, 0);
	assert(promptPositionResolved, "AI Pointer input position was unavailable");
	const shortRenderedWidth = answerScroll.get_width();
	const shortRenderedHeight = answerScroll.get_height();
	const shortAnswerWidth = answerScroll.widthRequest;
	const shortAnswerHeight = answerScroll.minContentHeight;
	assert(shortRenderedWidth === shortAnswerWidth, "AI Pointer answer expanded to the prompt width");
	view.showPartialAnswer("A longer streaming answer that should wrap across several lines. ".repeat(80));
	await settleMainLoop(50);
	assert(answer.get_label().startsWith("A longer streaming answer"), "AI Pointer partial answer was not rendered");
	assert(answerScroll.widthRequest > shortAnswerWidth, "AI Pointer answer did not grow horizontally");
	assert(answerScroll.widthRequest <= 640, "AI Pointer answer exceeded its width bound");
	assert(answerScroll.minContentHeight > shortAnswerHeight, "AI Pointer answer did not grow vertically");
	assert(answerScroll.minContentHeight > 480, "AI Pointer answer stopped at the former height cap");
	assert(answerScroll.minContentHeight <= 1_440, "AI Pointer answer exceeded its height bound");
	assert(answerScroll.get_height() < bounds.height, "AI Pointer answer exceeded its monitor");
	assert(answerScroll.get_width() > shortRenderedWidth, "AI Pointer answer did not render wider");
	assert(answerScroll.get_height() > shortRenderedHeight, "AI Pointer answer did not render taller");
	const [grownPromptPositionResolved, grownPromptLeft, grownPromptTop] = pill.translate_coordinates(window, 0, 0);
	assert(grownPromptPositionResolved, "grown AI Pointer input position was unavailable");
	assert(
		grownPromptLeft === promptLeft,
		`AI Pointer input moved horizontally from ${promptLeft} to ${grownPromptLeft}`,
	);
	assert(
		grownPromptTop === promptTop,
		`AI Pointer input moved vertically from ${promptTop} to ${grownPromptTop}`,
	);
	const adjustment = answerScroll.get_vadjustment();
	assert(
		adjustment.get_value() === adjustment.get_upper() - adjustment.get_page_size(),
		"AI Pointer answer did not follow the latest streamed text",
	);
	assert(action.has_css_class("requesting"), "partial answer changed the requesting action");
	view.showPartialAnswer("");
	assert(answer.get_label() === "", "AI Pointer partial answer was not cleared");
	action.emit("clicked");
	assert(cancelled === 1, "AI Pointer requesting action did not cancel");
	view.hide();
	await settleMainLoop();
	view.dispose();
	await settleMainLoop();
	assert(view.isCreated === false, "AI Pointer view was not disposed");
});
