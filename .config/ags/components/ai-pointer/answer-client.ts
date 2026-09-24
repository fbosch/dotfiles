import Gio from "gi://Gio?version=2.0";
import type { ProcessObserver } from "./owned-process";

export interface AnswerRequestInput {
	requestId: string;
	prompt: string;
	attachment: { path: string; sha256: string };
	timeoutSeconds: number;
}

export type AnswerClientResult =
	| { kind: "answered"; answer: string; truncated: boolean }
	| { kind: "cancelled" }
	| { kind: "failed"; code: "backend_unavailable"; message: string };

export type AnswerPreflightResult =
	| { kind: "ready" }
	| { kind: "failed"; code: "capture_unavailable" | "backend_unavailable" | "cancelled"; message: string };

const unavailableMessage = "AI Pointer answers are unavailable.";

export async function requestAnswer(
	_input: AnswerRequestInput,
	cancellable: Gio.Cancellable,
	_onProcess: ProcessObserver,
	onDelta?: (text: string) => void,
): Promise<AnswerClientResult> {
	if (cancellable.is_cancelled()) return { kind: "cancelled" };
	onDelta?.("");
	return { kind: "failed", code: "backend_unavailable", message: unavailableMessage };
}

export async function preflightAnswer(
	cancellable: Gio.Cancellable,
	_onProcess: ProcessObserver,
): Promise<AnswerPreflightResult> {
	if (cancellable.is_cancelled())
		return { kind: "failed", code: "cancelled", message: "The AI Pointer request was cancelled." };
	return { kind: "failed", code: "backend_unavailable", message: unavailableMessage };
}
