import { isMatching, match, P } from "ts-pattern";
import type { ComponentModule } from "@/services/component-host";
import { parseComponentRequest } from "@/services/request";
import { aboutThisPCRequestPattern } from "./request";

const PREPARATION_RELEASE_DELAY_MS = 1_000;
type IsolatedAboutThisPCRequest = P.infer<typeof aboutThisPCRequestPattern>;

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
	schedule(callback: () => void, delayMs: number): () => void;
}

export interface AboutThisPCLifecycle extends ComponentModule {
	intentStart(): void;
	intentEnd(): void;
	intentClear(): void;
}

export function createAboutThisPCLifecycle({
	launch,
	onShutdown,
	schedule,
}: IsolatedAboutThisPCOptions): AboutThisPCLifecycle {
	let initialized = false;
	let process: IsolatedUtilityProcess | null = null;
	let showClaims = 0;
	let stopping: Promise<void> | null = null;
	let visible = false;
	// Pointer and focus intent overlap; one claim owns preparation until delayed release.
	let intentCount = 0;
	let preparationClaimed = false;
	let cancelPendingRelease: (() => void) | null = null;

	function clearPendingRelease(): void {
		cancelPendingRelease?.();
		cancelPendingRelease = null;
	}

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

	function schedulePreparationRelease(): void {
		if (preparationClaimed === false || cancelPendingRelease) return;
		cancelPendingRelease = schedule(() => {
			cancelPendingRelease = null;
			preparationClaimed = false;
			void cancelPreparation().catch((error) => {
				console.error("Failed to release About This PC preparation:", error);
			});
		}, PREPARATION_RELEASE_DELAY_MS);
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

	function init(): void {
		if (initialized) return;
		initialized = true;
		onShutdown?.(() => {
			clearPendingRelease();
			intentCount = 0;
			preparationClaimed = false;
			visible = false;
			process?.terminate();
		});
	}

	function activate(): void {
		init();
		clearPendingRelease();
		intentCount = 0;
		preparationClaimed = false;
	}

	return {
		instanceName: "about-this-pc",
		init,
		intentStart() {
			init();
			clearPendingRelease();
			intentCount += 1;
			if (preparationClaimed) return;
			preparationClaimed = true;
			void prepare().catch((error) => {
				console.error("Failed to prepare About This PC:", error);
			});
		},
		intentEnd() {
			const previousCount = intentCount;
			intentCount = Math.max(0, intentCount - 1);
			if (previousCount === 1) schedulePreparationRelease();
		},
		intentClear() {
			intentCount = 0;
			schedulePreparationRelease();
		},
		handleRequest(argv, res) {
			const data = parseComponentRequest<{ action?: string }>(
				"about-this-pc",
				argv,
				res,
			);
			if (!data) return;
			const request: unknown = data;
			if (isMatching(aboutThisPCRequestPattern, request) === false) {
				res("unknown action");
				return;
			}

			match(request as IsolatedAboutThisPCRequest)
				.with({ action: "show" }, () => {
					activate();
					respondAfter(show(), "shown", res);
				})
				.with({ action: "hide" }, () => respondAfter(stop(), "hidden", res))
				.with({ action: "destroy" }, () =>
					respondAfter(stop(), "destroyed", res),
				)
				.with({ action: "is-visible" }, () => res(visible ? "true" : "false"))
				.exhaustive();
		},
	};
}
