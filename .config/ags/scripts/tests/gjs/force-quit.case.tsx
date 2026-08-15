import { ForceQuitController } from "../../../components/force-quit/controller";
import type { ForceQuitView } from "../../../components/force-quit/force-quit-view";
import { ForceQuitMetricsSampler } from "../../../components/force-quit/metrics";
import type {
	ForceQuitApplication,
	ForceQuitMetrics,
} from "../../../components/force-quit/model";
import { createRequestHandler } from "../../../components/force-quit/request-handler";
import type { ForceQuitOperation } from "../../../components/force-quit/termination";
import { assert, test } from "./harness";

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
	} finally {
		controller.teardown();
	}
});

test("Force Quit controller cancels an active operation on teardown", () => {
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
	controller.teardown();
	assert(cancelled, "teardown left the destructive operation active");
});
