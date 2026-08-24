import GLib from "gi://GLib?version=2.0";
import { SimulatedClock } from "xstate";
import { ConfirmDialogController } from "@/components/confirm-dialog/controller";
import {
	ConfirmDialogView,
	type ConfirmDialogViewHandlers,
} from "@/components/confirm-dialog/confirm-dialog-view";
import { executeConfirmOperation } from "@/components/confirm-dialog/operation-executor";
import type {
	ConfirmConfig,
	ConfirmOperation,
} from "@/components/confirm-dialog/request";
import { createRequestHandler } from "@/components/confirm-dialog/request-handler";
import { assert, test } from "./harness";

const config: ConfirmConfig = {
	icon: "!",
	title: "Confirm",
	message: "Proceed with this operation?",
	confirmLabel: "Confirm",
	cancelLabel: "Cancel",
	variant: "danger",
	operation: { type: "shutdown" },
	showDelay: 180,
};

function request(
	handler: (argv: string[], respond: (value: string) => void) => void,
	argv: string[],
): string {
	let response = "";
	handler(argv, (value) => {
		response = value;
	});
	return response;
}

function settleMainLoop(): Promise<void> {
	return new Promise((resolve) => {
		GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1, () => {
			resolve();
			return GLib.SOURCE_REMOVE;
		});
	});
}

test("Confirm Dialog validates requests before changing lifecycle", () => {
	const clock = new SimulatedClock();
	let handlers: ConfirmDialogViewHandlers | null = null;
	let shown = 0;
	let hidden = 0;
	let configured = 0;
	let operationErrors = 0;
	let visible = false;
	let executed: ConfirmOperation | null = null;
	let executionSucceeds = true;
	const view = {
		create(nextHandlers: ConfirmDialogViewHandlers) {
			handlers = nextHandlers;
		},
		setConfig() {
			configured += 1;
		},
		showOperationError() {
			operationErrors += 1;
		},
		show() {
			shown += 1;
			visible = true;
		},
		hide() {
			hidden += 1;
			visible = false;
		},
		dispose() {},
	} as unknown as ConfirmDialogView;
	const controller = new ConfirmDialogController({
		view,
		clock,
		execute: (operation) => {
			executed = operation;
			return executionSucceeds;
		},
		playWarningSound: () => null,
	});
	const handle = createRequestHandler(controller);
	controller.init();
	try {
		assert(handlers === null, "dialog view was created during initialization");
		assert(request(handle, []) === "ready", "empty request response changed");
		assert(
			request(handle, ["not-json"]) === "error: invalid JSON",
			"invalid JSON was accepted",
		);
		assert(
			request(handle, [JSON.stringify({ action: "show" })]) ===
				"unknown action",
			"malformed show request was accepted",
		);
		assert(configured === 0, "malformed request mutated dialog configuration");
		assert(handlers === null, "invalid request created the dialog view");
		assert(
			request(handle, [JSON.stringify({ action: "show", config })]) === "shown",
			"valid show request failed",
		);
		assert(configured === 1 && shown === 0, "show delay was not preserved");
		clock.increment(180);
		assert(shown === 1, "dialog was not shown after its delay");
		assert(
			request(handle, [JSON.stringify({
				action: "show",
				config: { ...config, title: "Replacement" },
			})]) === "shown",
			"duplicate show response changed",
		);
		assert(configured === 1, "active dialog was replaced by a duplicate show");
		handlers?.onConfirm();
		assert(executed?.type === "shutdown", "confirm did not execute the operation");
		assert(hidden > 0, "confirm did not hide the dialog");
		executionSucceeds = false;
		request(handle, [
			JSON.stringify({ action: "show", config: { ...config, showDelay: 0 } }),
		]);
		handlers?.onConfirm();
		assert(operationErrors === 1, "operation failure was not shown in the dialog");
		assert(visible, "operation failure dismissed the visible dialog");
	} finally {
		controller.teardown();
	}
});

test("Confirm Dialog maps operations only to fixed argv or dispatch", () => {
	const spawned: string[][] = [];
	const dispatched: string[] = [];
	const dependencies = {
		homeDirectory: "/home/test",
		findProgram: (name: string) => (name === "systemctl" ? "/bin/systemctl" : null),
		spawn: (argv: string[]) => spawned.push(argv),
		dispatch: (expression: string) => {
			dispatched.push(expression);
			return true;
		},
	};
	const cases: Array<[ConfirmOperation, string[]]> = [
		[
			{ type: "shutdown" },
			[
				"/home/test/.config/hypr/runtime/session/hyprshutdown-session.sh",
				"--no-exit",
				"-t",
				"Shutting down...",
				"--post-cmd",
				"systemctl poweroff",
			],
		],
		[
			{ type: "restart" },
			[
				"/home/test/.config/hypr/runtime/session/hyprshutdown-session.sh",
				"-t",
				"Restarting...",
				"--post-cmd",
				"systemctl reboot",
			],
		],
		[{ type: "suspend" }, ["/bin/systemctl", "suspend"]],
		[
			{ type: "exit-session" },
			["/home/test/.config/hypr/runtime/session/exit-session.sh"],
		],
		[
			{ type: "kill-process", pid: 42 },
			[
				"/home/test/.config/hypr/runtime/windows/kill-pid-with-fallback.sh",
				"42",
			],
		],
	];
	for (const [operation, expectedArgv] of cases) {
		assert(
			executeConfirmOperation(operation, dependencies),
			`${operation.type} did not execute`,
		);
		assert(
			spawned.at(-1)?.join("\0") === expectedArgv.join("\0"),
			`${operation.type} argv changed`,
		);
	}
	assert(
		executeConfirmOperation(
			{ type: "close-window", address: "0xabc" },
			dependencies,
		),
		"window close did not dispatch",
	);
	assert(
		dispatched[0] === 'hl.dsp.window.close({ window = "address:0xabc" })',
		"window dispatch changed",
	);
	assert(
		executeConfirmOperation(
			{ type: "suspend" },
			{ ...dependencies, findProgram: () => null },
		) === false,
		"missing systemctl was accepted",
	);
	assert(
		executeConfirmOperation(
			{ type: "close-window", address: "0xdef" },
			{ ...dependencies, dispatch: () => false },
		) === false,
		"failed dispatch was reported as successful",
	);
});

test("Confirm Dialog view creates, updates, maps, and disposes", async () => {
	const view = new ConfirmDialogView();
	view.create({ onCancel() {}, onConfirm() {} });
	view.setConfig(config);
	view.show();
	await settleMainLoop();
	assert(view.isCreated, "confirm dialog view was not created");
	view.hide();
	view.dispose();
	assert(view.isCreated === false, "confirm dialog view was not disposed");
});
