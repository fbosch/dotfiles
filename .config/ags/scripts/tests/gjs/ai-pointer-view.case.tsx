import app from "ags/gtk4/app";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import { AiPointerView } from "@/components/ai-pointer/ai-pointer-view";
import { assert, test } from "./harness";

function settleMainLoop(): Promise<void> {
	return new Promise((resolve) => {
		GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1, () => {
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
	const geometry = { x: 10, y: 20, width: 20, height: 20 };
	view.showPreparing(geometry);
	await settleMainLoop();
	await settleMainLoop();
	assert(view.isCreated, "AI Pointer view was not created");
	assert(view.isPromptVisible, "AI Pointer prompt was not shown");
	const window = app.get_window("ai-pointer");
	assert(window !== null, "AI Pointer window was not registered");
	const prompt = findWidgetWithClass(window, "ai-pointer-prompt-input");
	const action = findWidgetWithClass(window, "ai-pointer-action");
	const pill = findWidgetWithClass(window, "ai-pointer-prompt-pill");
	const answer = findWidgetWithClass(window, "ai-pointer-answer");
	assert(prompt instanceof Gtk.Entry, "AI Pointer question input was not rendered");
	assert(action instanceof Gtk.Button, "AI Pointer action was not rendered");
	assert(pill instanceof Gtk.Box, "AI Pointer pill was not rendered");
	assert(answer instanceof Gtk.Label, "AI Pointer answer label was not rendered");
	assert(pill.get_height() <= 50, "AI Pointer pill exceeded the design-system height");
	assert(
		action.get_width() === 32 && action.get_height() === 32,
		`AI Pointer action was ${action.get_width()}x${action.get_height()} instead of 32x32`,
	);
	assert(action.get_sensitive() === false, "empty AI Pointer question was submittable");
	prompt.set_text(`  ${"question ".repeat(80)}  `);
	assert(prompt.widthRequest === 348, "AI Pointer question did not grow to its width bound");
	assert(action.get_sensitive() === false, "question was submittable before capture completed");
	assert(
		view.showPrompt({ path: capturePath, geometry, sha256: "a".repeat(64) }),
		"AI Pointer question prompt was rejected",
	);
	assert(prompt.get_text().includes("question"), "capture completion cleared the prepared question");
	assert(action.get_sensitive(), "non-empty AI Pointer question was not submittable");
	prompt.set_text("keep this question");
	assert(
		view.showPrompt({ path: capturePath, geometry, sha256: "a".repeat(64) }),
		"AI Pointer repeated prompt update was rejected",
	);
	assert(prompt.get_text() === "keep this question", "a repeated component update cleared the question");
	action.emit("clicked");
	assert(submitted === "keep this question", "AI Pointer submitted the wrong question");
	view.showRequesting();
	assert(action.has_css_class("requesting"), "AI Pointer requesting action was not presented");
	view.showPartialAnswer("Streaming plain text");
	assert(answer.get_label() === "Streaming plain text", "AI Pointer partial answer was not rendered");
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
