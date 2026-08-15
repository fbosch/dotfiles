import { ForceQuitController } from "../../../components/force-quit/controller";
import type { ForceQuitView } from "../../../components/force-quit/force-quit-view";
import { ForceQuitMetricsSampler } from "../../../components/force-quit/metrics";
import type {
	ForceQuitApplication,
	ForceQuitMetrics,
} from "../../../components/force-quit/model";
import { createRequestHandler } from "../../../components/force-quit/request-handler";
import {
	forceQuitApplication,
	type ForceQuitOperation,
	type ForceQuitTerminationDependencies,
} from "../../../components/force-quit/termination";
import { assert, test } from "./harness";
import type { ComponentModule } from "../../../services/component-host";

const applications: ForceQuitApplication[] = [
	{
		id: "example",
		name: "Example",
		icon: null,
		fallbackLetter: "E",
		pids: [42],
		windows: [{ address: "0xabc", pid: 42, class: "Example" }],
	},
];

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

test("Force Quit handles its complete request and view lifecycle", () => {
	let mapped = false;
	let renders = 0;
	let destroys = 0;
	const view = {
		get isMapped() {
			return mapped;
		},
		create() {},
		present() {
			mapped = true;
		},
		render() {
			renders += 1;
		},
		updateMetrics() {},
		destroy() {
			mapped = false;
			destroys += 1;
		},
	} as unknown as ForceQuitView;
	const metrics = {
		sample: () => new Map<string, ForceQuitMetrics>(),
		clear() {},
	} as ForceQuitMetricsSampler;
	const controller = new ForceQuitController({
		view,
		getApplications: () => applications,
		metrics,
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
		assert(renders === 1 && mapped, "show did not render and map the view");
		assert(
			request(handle, [JSON.stringify({ action: "is-visible" })]) === "true",
			"visible state was not reported",
		);
		assert(
			request(handle, [JSON.stringify({ action: "hide" })]) === "hidden",
			"hide request failed",
		);
		assert(destroys >= 1 && mapped === false, "hide did not destroy the view");
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

test("Force Quit controller cancels an active operation when hidden", () => {
	let mapped = false;
	let handlers: Parameters<ForceQuitView["create"]>[0] | null = null;
	let cancelled = false;
	const view = {
		get isMapped() {
			return mapped;
		},
		create(nextHandlers: Parameters<ForceQuitView["create"]>[0]) {
			handlers = nextHandlers;
		},
		present() {
			mapped = true;
		},
		render() {},
		updateMetrics() {},
		destroy() {
			mapped = false;
		},
	} as unknown as ForceQuitView;
	const controller = new ForceQuitController({
		view,
		getApplications: () => applications,
		metrics: {
			sample: () => new Map(),
			clear() {},
		} as ForceQuitMetricsSampler,
		terminate: (_application, _onComplete): ForceQuitOperation => ({
			cancel() {
				cancelled = true;
			},
		}),
	});
	controller.init();
	controller.show();
	handlers?.onSelect("example");
	handlers?.onForceQuit();
	controller.hide();
	assert(cancelled, "hide left the destructive operation active");
	controller.teardown();
});

test("Force Quit termination revalidates, signals, and cancels safely", () => {
	let nextSource = 1;
	const callbacks = new Map<number, () => void>();
	const cancelledSources: number[] = [];
	const dispatches: string[] = [];
	const signalled: number[][] = [];
	const results: string[] = [];
	const snapshots = [applications, applications];
	const dependencies: ForceQuitTerminationDependencies = {
		getApplications: () => snapshots.shift() ?? [],
		dispatch: (expression) => dispatches.push(expression),
		signal: (windows) => signalled.push(windows.map((window) => window.pid)),
		schedule: (_delay, callback) => {
			const source = nextSource++;
			callbacks.set(source, callback);
			return source;
		},
		cancelSource: (source) => cancelledSources.push(source),
	};
	forceQuitApplication(applications[0], (result) => results.push(result), dependencies);
	assert(dispatches.length === 1, "graceful close was not dispatched");
	callbacks.get(1)?.();
	assert(signalled[0]?.join(",") === "42", "surviving PID was not signalled");
	callbacks.get(2)?.();
	assert(results.join(",") === "terminated", "termination did not complete once");

	const cancelled = forceQuitApplication(
		applications[0],
		(result) => results.push(result),
		{
			...dependencies,
			getApplications: () => applications,
		},
	);
	cancelled.cancel();
	assert(cancelledSources.includes(3), "active grace source was not removed");
	callbacks.get(3)?.();
	assert(signalled.length === 1, "cancelled operation still signalled a process");
	assert(results.join(",") === "terminated", "cancelled operation completed");
});

test("Force Quit registers through its lazy feature entry", async () => {
	await import("../../../components/force-quit/index");
	const component = (
		globalThis as typeof globalThis & { ForceQuit: ComponentModule }
	).ForceQuit;
	component.init();
	assert(component.instanceName === "force-quit", "lazy component name changed");
	assert(
		request(component.handleRequest, [JSON.stringify({ action: "is-visible" })]) ===
			"false",
		"lazy component did not serve its request contract",
	);
});
