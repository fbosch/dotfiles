import GLib from "gi://GLib?version=2.0";
import Gio from "gi://Gio?version=2.0";
import { preflightAnswer, type AnswerPreflightResult } from "./answer-client";
import type { AiPointerView } from "./ai-pointer-view";
import type { PointerStroke } from "./stroke";

type SelectionView = Pick<AiPointerView, "beginStroke" | "endStroke">;

export function beginPreflightSelection(
	view: SelectionView,
	stroke: PointerStroke,
	onFrame: () => void,
): boolean {
	try {
		if (view.beginStroke(stroke, onFrame)) return true;
	} catch {
		// Selector startup failures are handled as bounded availability failures.
	}
	try {
		view.endStroke();
	} catch {
		// No later workflow work may depend on selector cleanup succeeding.
	}
	return false;
}

export async function preflightAiPointer(
	cancellable: Gio.Cancellable,
	onProcess: (process: Gio.Subprocess | null) => void,
): Promise<AnswerPreflightResult> {
	if (GLib.find_program_in_path("grim") === null) {
		return {
			kind: "failed",
			code: "capture_unavailable",
			message: "Screen capture is unavailable.",
		};
	}

	return await preflightAnswer(cancellable, onProcess);
}

export async function runSelectionPreflight(
	preflight: typeof preflightAiPointer,
	cancellable: Gio.Cancellable,
	onProcess: (process: Gio.Subprocess | null) => void,
): Promise<AnswerPreflightResult> {
	try {
		return await preflight(cancellable, onProcess);
	} catch {
		return {
			kind: "failed",
			code: "backend_unavailable",
			message: "The AI Pointer readiness check failed.",
		};
	}
}
