import { isMatching, match, P } from "ts-pattern";
import type { ComponentModule } from "@/services/component-host";
import { parseComponentRequest } from "@/services/request";
import { aboutThisPCRequestPattern } from "./request";

const isolatedAboutThisPCRequestPattern = P.union(
	aboutThisPCRequestPattern,
	{ action: "prepare" },
	{ action: "cancel-prepare" },
);
type IsolatedAboutThisPCRequest = P.infer<
	typeof isolatedAboutThisPCRequestPattern
>;

export interface IsolatedUtilityProcess {
	readonly ready: Promise<void>;
	readonly completion: Promise<void>;
	request(action: "show"): Promise<void>;
	stop(): Promise<void>;
	terminate(): void;
}

interface IsolatedAboutThisPCOptions {
	launch(): IsolatedUtilityProcess;
	onShutdown?(callback: () => void): void;
}

export function createIsolatedAboutThisPCComponent({
	launch,
	onShutdown,
}: IsolatedAboutThisPCOptions): ComponentModule {
	let initialized = false;
	let process: IsolatedUtilityProcess | null = null;
	let showClaims = 0;
	let stopping: Promise<void> | null = null;
	let visible = false;

	function trackProcess(nextProcess: IsolatedUtilityProcess): void {
		process = nextProcess;
		void nextProcess.completion.then(
			() => {
				if (process !== nextProcess) return;
				process = null;
				visible = false;
			},
			(error) => {
				console.error("Isolated About This PC process failed:", error);
				if (process !== nextProcess) return;
				process = null;
				visible = false;
			},
		);
	}

	function stopProcess(runningProcess: IsolatedUtilityProcess): Promise<void> {
		visible = false;
		if (stopping) return stopping;
		stopping = (async () => {
			try {
				await runningProcess.stop();
			} finally {
				await runningProcess.completion;
			}
		})().finally(() => {
			if (process === runningProcess) process = null;
			stopping = null;
		});
		return stopping;
	}

	async function prepare(): Promise<IsolatedUtilityProcess> {
		if (stopping) await stopping;
		const runningProcess = process;
		if (runningProcess) {
			await runningProcess.ready;
			return runningProcess;
		}

		const nextProcess = launch();
		trackProcess(nextProcess);
		try {
			await nextProcess.ready;
			if (process !== nextProcess) throw new Error("utility exited during startup");
			return nextProcess;
		} catch (error) {
			try {
				await stopProcess(nextProcess);
			} catch (stopError) {
				console.error("Failed to clean up isolated About This PC:", stopError);
			}
			throw error;
		}
	}

	async function show(): Promise<void> {
		showClaims += 1;
		let shown = false;
		try {
			const runningProcess = await prepare();
			await runningProcess.request("show");
			if (process !== runningProcess || stopping)
				throw new Error("utility exited while being shown");
			visible = true;
			shown = true;
		} finally {
			showClaims -= 1;
			if (shown === false && showClaims === 0 && visible === false) {
				try {
					await stop();
				} catch (error) {
					console.error("Failed to clean up unsuccessful About This PC show:", error);
				}
			}
		}
	}

	async function cancelPreparation(): Promise<void> {
		if (visible || showClaims > 0) return;
		await stop();
	}

	async function stop(): Promise<void> {
		visible = false;
		if (stopping) return stopping;
		const runningProcess = process;
		if (!runningProcess) return;
		return stopProcess(runningProcess);
	}

	function respondAfter(
		operation: Promise<void>,
		response: string,
		res: (response: string) => void,
	): void {
		void operation.then(
			() => res(response),
			(error) => {
				console.error("Failed to control isolated About This PC:", error);
				res("error: utility unavailable");
			},
		);
	}

	return {
		instanceName: "about-this-pc",
		init() {
			if (initialized) return;
			initialized = true;
			onShutdown?.(() => {
				visible = false;
				process?.terminate();
			});
		},
		handleRequest(argv, res) {
			const data = parseComponentRequest<{ action?: string }>(
				"about-this-pc",
				argv,
				res,
			);
			if (!data) return;
			const request: unknown = data;
			if (isMatching(isolatedAboutThisPCRequestPattern, request) === false) {
				res("unknown action");
				return;
			}

			match(request as IsolatedAboutThisPCRequest)
				.with({ action: "prepare" }, () =>
					respondAfter(prepare().then(() => {}), "prepared", res),
				)
				.with({ action: "cancel-prepare" }, () =>
					respondAfter(cancelPreparation(), "cancelled", res),
				)
				.with({ action: "show" }, () => respondAfter(show(), "shown", res))
				.with({ action: "hide" }, () => respondAfter(stop(), "hidden", res))
				.with({ action: "destroy" }, () =>
					respondAfter(stop(), "destroyed", res),
				)
				.with({ action: "is-visible" }, () => res(visible ? "true" : "false"))
				.exhaustive();
		},
	};
}
