import Gio from "gi://Gio?version=2.0";
import type { ProcessObserver } from "./owned-process";
import { settleProcessesForShutdown } from "./shutdown-processes";

type OperationName = "answer" | "capture" | "ocr" | "preflight";

interface OperationState {
	cancellable: Gio.Cancellable;
	closed: boolean;
	name: OperationName;
	process: Gio.Subprocess | null;
}

export interface AiPointerOperation {
	readonly cancellable: Gio.Cancellable;
	readonly observeProcess: ProcessObserver;
	complete(): void;
}

export class AiPointerOperationRegistry {
	readonly #active = new Map<OperationName, OperationState>();
	readonly #terminatingProcesses = new Set<Gio.Subprocess>();

	start(name: OperationName): AiPointerOperation {
		this.cancel(name);
		const state: OperationState = {
			cancellable: new Gio.Cancellable(),
			closed: false,
			name,
			process: null,
		};
		this.#active.set(name, state);
		return {
			cancellable: state.cancellable,
			complete: () => this.#complete(state),
			observeProcess: (process) => this.#observeProcess(state, process),
		};
	}

	cancel(name: OperationName): void {
		const state = this.#active.get(name);
		if (state) this.#cancel(state);
	}

	cancelAll(): void {
		for (const state of [...this.#active.values()]) this.#cancel(state);
	}

	settleForShutdown(): void {
		this.cancelAll();
		settleProcessesForShutdown(this.#terminatingProcesses);
		this.#terminatingProcesses.clear();
	}

	#cancel(state: OperationState): void {
		if (state.closed) return;
		state.closed = true;
		if (this.#active.get(state.name) === state) this.#active.delete(state.name);
		if (state.process) this.#terminatingProcesses.add(state.process);
		state.cancellable.cancel();
	}

	#complete(state: OperationState): void {
		if (state.closed) return;
		state.closed = true;
		if (this.#active.get(state.name) === state) this.#active.delete(state.name);
		if (!state.process) return;
		this.#terminatingProcesses.add(state.process);
		state.cancellable.cancel();
	}

	#observeProcess(state: OperationState, process: Gio.Subprocess | null): void {
		if (!process) {
			if (state.process) this.#terminatingProcesses.delete(state.process);
			state.process = null;
			return;
		}

		state.process = process;
		if (state.closed) {
			this.#terminatingProcesses.add(process);
			state.cancellable.cancel();
		}
	}
}
