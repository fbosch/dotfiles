import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { AboutThisPCController } from "../../../components/about-this-pc/controller";
import type { AboutThisPCView } from "../../../components/about-this-pc/about-this-pc-view";
import type { AboutThisPCInfo } from "../../../components/about-this-pc/model";
import {
	launchAboutMoreInfo,
	type MoreInfoDependencies,
} from "../../../components/about-this-pc/more-info";
import { createRequestHandler } from "../../../components/about-this-pc/request-handler";
import { runHardwareProbe } from "../../../components/about-this-pc/system-info";
import type { ComponentModule } from "../../../services/component-host";
import { assert, test } from "./harness";

const info: AboutThisPCInfo = {
	deviceName: "Example PC",
	deviceIcon: "\uE7FB",
	processor: "Example CPU",
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

function createFakeView() {
	let mapped = false;
	let renders = 0;
	let handlers: Parameters<AboutThisPCView["create"]>[0] | null = null;
	const view = {
		get isMapped() {
			return mapped;
		},
		create(nextHandlers: Parameters<AboutThisPCView["create"]>[0]) {
			handlers = nextHandlers;
		},
		present() {
			mapped = true;
		},
		focusMoreInfo() {},
		showStatus() {},
		hideStatus() {},
		render() {
			renders += 1;
		},
		destroy() {
			mapped = false;
		},
	} as unknown as AboutThisPCView;
	return { view, handlers: () => handlers, renders: () => renders };
}

test("About This PC handles its complete request lifecycle", async () => {
	const fake = createFakeView();
	const controller = new AboutThisPCController({
		view: fake.view,
		getInfo: () => Promise.resolve(info),
		launchMoreInfo: () => true,
	});
	const handle = createRequestHandler(controller);
	controller.init();
	try {
		assert(request(handle, []) === "ready", "empty request response changed");
		assert(
			request(handle, ["not-json"]) === "error: invalid JSON",
			"invalid JSON was accepted",
		);
		assert(
			request(handle, [JSON.stringify({ action: "show" })]) === "shown",
			"show request failed",
		);
		await Promise.resolve();
		assert(fake.renders() === 1, "loaded system information was not rendered");
		assert(
			request(handle, [JSON.stringify({ action: "is-visible" })]) === "true",
			"visible state was not reported",
		);
		assert(
			request(handle, [JSON.stringify({ action: "hide" })]) === "hidden",
			"hide request failed",
		);
		assert(
			request(handle, [JSON.stringify({ action: "destroy" })]) === "destroyed",
			"destroy request failed",
		);
		assert(
			request(handle, [JSON.stringify({ action: "unknown" })]) ===
				"unknown action",
			"unknown action response changed",
		);
	} finally {
		controller.teardown();
	}
});

test("About This PC rejects results from a hidden lifecycle", async () => {
	const fake = createFakeView();
	let resolveInfo: ((value: AboutThisPCInfo) => void) | null = null;
	let cancellable: Gio.Cancellable | null = null;
	const controller = new AboutThisPCController({
		view: fake.view,
		getInfo: (nextCancellable) => {
			cancellable = nextCancellable;
			return new Promise((resolve) => {
				resolveInfo = resolve;
			});
		},
	});
	controller.init();
	controller.show();
	controller.hide();
	assert(cancellable?.is_cancelled() === true, "hide did not cancel system probes");
	resolveInfo?.(info);
	await Promise.resolve();
	assert(fake.renders() === 0, "stale system information reached the hidden view");
	controller.teardown();
});

test("About This PC hardware probe owns active cancellation", async () => {
	const executable = GLib.find_program_in_path("sleep");
	assert(Boolean(executable), "sleep executable unavailable for cancellation test");
	if (!executable) return;
	const cancellable = new Gio.Cancellable();
	const pending = runHardwareProbe([executable, "30"], cancellable);
	cancellable.cancel();
	assert((await pending) === undefined, "cancelled hardware probe returned output");
	for (let index = 0; index < 2; index++) {
		const preCancelled = new Gio.Cancellable();
		preCancelled.cancel();
		assert(
			(await runHardwareProbe([executable, "30"], preCancelled)) === undefined,
			"pre-cancelled hardware probe returned output",
		);
		assert(
			(await runHardwareProbe([executable, "30"], null, 5)) === undefined,
			"timed-out hardware probe returned output",
		);
	}
});

test("About This PC More Info keeps configured text in argv", () => {
	const spawned: string[][] = [];
	const dependencies: MoreInfoDependencies = {
		configuredCommand: () => 'fastfetch --logo "none; touch /tmp/should-not-exist"',
		parseArgv: (command) => {
			const [success, argv] = GLib.shell_parse_argv(command);
			return success && argv ? argv : null;
		},
		findProgram: (name) =>
			name === "fastfetch" || name === "footclient" ? `/fake/${name}` : null,
		clients: () => [],
		focus: () => false,
		spawn: (argv) => spawned.push(argv),
	};
	assert(launchAboutMoreInfo(dependencies), "More Info did not launch");
	assert(spawned.length === 1, "More Info spawned more than one terminal");
	assert(
		spawned[0]?.at(-1) === "none; touch /tmp/should-not-exist",
		"configured argument was reparsed as shell syntax",
	);

	let focused = "";
	assert(
		launchAboutMoreInfo({
			...dependencies,
			clients: () => [{ address: "0xabc", class: "about_this_pc_more_info" }],
			focus: (address) => {
				focused = address;
				return true;
			},
		}),
		"existing More Info window was not focused",
	);
	assert(focused === "0xabc" && spawned.length === 1, "focus path spawned a duplicate");
});

test("About This PC registers through its lazy feature entry", async () => {
	await import("../../../components/about-this-pc/index");
	const component = (
		globalThis as typeof globalThis & { AboutThisPC: ComponentModule }
	).AboutThisPC;
	component.init();
	assert(component.instanceName === "about-this-pc", "lazy component name changed");
	assert(
		request(component.handleRequest, [JSON.stringify({ action: "is-visible" })]) ===
			"false",
		"lazy component did not serve its request contract",
	);
});
