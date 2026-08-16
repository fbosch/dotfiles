import { describe, expect, test } from "bun:test";
import { isMatching } from "ts-pattern";
import { confirmDialogRequestPattern } from "../request";

function showRequest(operation: object = { type: "shutdown" }) {
	return {
		action: "show",
		config: {
			icon: "!",
			title: "Confirm",
			message: "Proceed with this operation?",
			confirmLabel: "Confirm",
			cancelLabel: "Cancel",
			variant: "danger",
			operation,
		},
	};
}

describe("confirmDialogRequestPattern", () => {
	test.each([
		{ type: "shutdown" },
		{ type: "restart" },
		{ type: "suspend" },
		{ type: "exit-session" },
		{ type: "kill-process", pid: 42 },
		{ type: "close-window", address: "0xabc123" },
	])("accepts the allow-listed operation $type", (operation) => {
		expect(isMatching(confirmDialogRequestPattern, showRequest(operation))).toBe(
			true,
		);
	});

	test("rejects legacy arbitrary commands", () => {
		expect(
			isMatching(confirmDialogRequestPattern, {
				...showRequest(),
				config: {
					...showRequest().config,
					confirmCommand: "rm -rf -- /",
				},
			}),
		).toBe(false);
	});

	test.each([
		{ type: "kill-process", pid: 0 },
		{ type: "kill-process", pid: Number.POSITIVE_INFINITY },
		{ type: "close-window", address: "activewindow" },
		{ type: "shell", command: "systemctl poweroff" },
	])("rejects unsafe operation input", (operation) => {
		expect(isMatching(confirmDialogRequestPattern, showRequest(operation))).toBe(
			false,
		);
	});

	test("rejects oversized text and non-finite delays", () => {
		expect(
			isMatching(confirmDialogRequestPattern, {
				...showRequest(),
				config: { ...showRequest().config, message: "x".repeat(241) },
			}),
		).toBe(false);
		expect(
			isMatching(confirmDialogRequestPattern, {
				...showRequest(),
				config: { ...showRequest().config, showDelay: Number.NaN },
			}),
		).toBe(false);
	});
});
