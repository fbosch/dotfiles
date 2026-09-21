import type { LightState } from "./types";

export type LightUpdatePayload = {
	brightness?: number;
	hs_color?: [number, number];
};

export type LightUpdateRollback = {
	brightness?: number;
	hs_color?: [number, number];
};

type LightUpdateField = keyof LightUpdatePayload;
type RollbackValue = number | [number, number] | undefined;
export type LightUpdateSchedulerTimer = object | number;

export type LightUpdateScheduler = {
	setTimeout: (callback: () => void, delay: number) => LightUpdateSchedulerTimer;
	clearTimeout: (timer: LightUpdateSchedulerTimer) => void;
	wait: (delay: number) => Promise<void>;
};

export type LightUpdateContext = {
	entityId: string;
	generation: number;
	label: string;
	kind: "settings" | "action";
	silent: boolean;
};

type Request = {
	execute: (payload: LightUpdatePayload) => Promise<void>;
	afterSuccess: (
		context: LightUpdateContext,
	) => Promise<boolean | LightState | undefined>;
	label: string;
	kind: LightUpdateContext["kind"];
	silent: boolean;
};

type Operation = {
	generation: number;
	desired: LightUpdatePayload;
	rollback: Map<LightUpdateField, RollbackValue>;
	running: boolean;
	runRequested: boolean;
	awaitingConfirmation: boolean;
	timer?: LightUpdateSchedulerTimer;
	confirmationTimer?: LightUpdateSchedulerTimer;
	request: Request;
};

export type LightUpdateCoordinatorCallbacks = {
	onChange?: () => void;
	onRollback?: (entityId: string, rollback: LightUpdateRollback) => void;
	onError?: (
		error: unknown,
		context: LightUpdateContext & { stale: boolean },
	) => void;
	onSuccess?: (context: LightUpdateContext) => void;
};

export type SubmitSettingsOptions = {
	debounce?: boolean;
	silent?: boolean;
	label: string;
	execute: (payload: LightUpdatePayload) => Promise<void>;
	afterSuccess: Request["afterSuccess"];
};

export type SubmitActionOptions = {
	label: string;
	execute: () => Promise<void>;
	afterSuccess: Request["afterSuccess"];
};

const FIELDS: LightUpdateField[] = ["brightness", "hs_color"];
const CONFIRMATION_TOLERANCE = 1;

const defaultScheduler: LightUpdateScheduler = {
	setTimeout: (callback, delay) => setTimeout(callback, delay),
	clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
	wait: (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
};

function cloneValue(value: RollbackValue): RollbackValue {
	return Array.isArray(value) ? ([...value] as [number, number]) : value;
}

function clonePayload(payload: LightUpdatePayload): LightUpdatePayload {
	return {
		...(payload.brightness !== undefined
			? { brightness: payload.brightness }
			: {}),
		...(payload.hs_color !== undefined
			? { hs_color: [...payload.hs_color] as [number, number] }
			: {}),
	};
}

function hasField(
	payload: LightUpdatePayload,
	field: LightUpdateField,
): boolean {
	return Object.prototype.hasOwnProperty.call(payload, field);
}

function fieldsOf(payload: LightUpdatePayload): LightUpdateField[] {
	return FIELDS.filter((field) => hasField(payload, field));
}

function readField(light: LightState, field: LightUpdateField): RollbackValue {
	return cloneValue(light.attributes[field]);
}

function mergePayload(
	current: LightUpdatePayload,
	update: LightUpdatePayload,
): LightUpdatePayload {
	return {
		...clonePayload(current),
		...clonePayload(update),
	};
}

function rollbackFromMap(
	rollback: Map<LightUpdateField, RollbackValue>,
): LightUpdateRollback {
	const result: LightUpdateRollback = {};
	for (const [field, value] of rollback) {
		if (field === "brightness") result.brightness = value as number | undefined;
		if (field === "hs_color") {
			result.hs_color = value as [number, number] | undefined;
		}
	}
	return result;
}

export function applyLightUpdate(
	light: LightState,
	payload: LightUpdatePayload,
): LightState {
	const attributes = { ...light.attributes };
	if (hasField(payload, "brightness"))
		attributes.brightness = payload.brightness;
	if (hasField(payload, "hs_color")) {
		attributes.hs_color = payload.hs_color
			? ([...payload.hs_color] as [number, number])
			: undefined;
	}
	return { ...light, attributes };
}

export function matchesLightUpdate(
	light: LightState,
	payload: LightUpdatePayload,
): boolean {
	if (hasField(payload, "brightness")) {
		const actual = light.attributes.brightness;
		const expected = payload.brightness;
		if (
			actual === undefined ||
			expected === undefined ||
			Math.abs(actual - expected) > CONFIRMATION_TOLERANCE
		) {
			return false;
		}
	}
	if (hasField(payload, "hs_color")) {
		const actual = light.attributes.hs_color;
		const expected = payload.hs_color;
		if (
			!actual ||
			!expected ||
			Math.abs(actual[0] - expected[0]) > CONFIRMATION_TOLERANCE ||
			Math.abs(actual[1] - expected[1]) > CONFIRMATION_TOLERANCE
		) {
			return false;
		}
	}
	return true;
}

export class LightUpdateCoordinator {
	private readonly operations = new Map<string, Operation>();
	private readonly callbacks: LightUpdateCoordinatorCallbacks;
	private readonly debounceMs: number;
	private readonly transitionMs: number;
	private readonly confirmationTimeoutMs: number;
	private readonly scheduler: LightUpdateScheduler;
	private disposed = false;

	constructor({
		callbacks = {},
		debounceMs = 500,
		transitionMs = 1_250,
		confirmationTimeoutMs = 5_000,
		scheduler = defaultScheduler,
	}: {
		callbacks?: LightUpdateCoordinatorCallbacks;
		debounceMs?: number;
		transitionMs?: number;
		confirmationTimeoutMs?: number;
		scheduler?: LightUpdateScheduler;
	} = {}) {
		this.callbacks = callbacks;
		this.debounceMs = debounceMs;
		this.transitionMs = transitionMs;
		this.confirmationTimeoutMs = confirmationTimeoutMs;
		this.scheduler = scheduler;
	}

	submitSettings(
		entityId: string,
		currentLight: LightState,
		payload: LightUpdatePayload,
		options: SubmitSettingsOptions,
	): void {
		const operation = this.getOrCreate(entityId, {
			execute: options.execute,
			afterSuccess: options.afterSuccess,
			label: options.label,
			kind: "settings",
			silent: options.silent ?? false,
		});
		this.clearConfirmationTimer(operation);
		for (const field of fieldsOf(payload)) {
			if (!operation.rollback.has(field)) {
				operation.rollback.set(field, readField(currentLight, field));
			}
		}
		operation.desired = mergePayload(operation.desired, payload);
		operation.generation += 1;
		operation.request = {
			execute: options.execute,
			afterSuccess: options.afterSuccess,
			label: options.label,
			kind: "settings",
			silent: options.silent ?? false,
		};
		operation.awaitingConfirmation = false;
		operation.runRequested = true;
		this.clearTimer(operation);
		if (options.debounce) {
			operation.timer = this.scheduler.setTimeout(() => {
				operation.timer = undefined;
				this.start(entityId, operation);
			}, this.debounceMs);
		} else {
			this.start(entityId, operation);
		}
		this.notifyChange();
	}

	submitAction(entityId: string, options: SubmitActionOptions): void {
		const operation = this.getOrCreate(entityId, {
			label: options.label,
			execute: async () => undefined,
			afterSuccess: options.afterSuccess,
			kind: "action",
			silent: false,
		});
		this.clearTimer(operation);
		this.clearConfirmationTimer(operation);
		operation.generation += 1;
		operation.desired = {};
		operation.request = {
			execute: async () => options.execute(),
			afterSuccess: options.afterSuccess,
			label: options.label,
			kind: "action",
			silent: false,
		};
		operation.awaitingConfirmation = false;
		operation.runRequested = true;
		this.start(entityId, operation);
		this.notifyChange();
	}

	getDesired(entityId: string): LightUpdatePayload | undefined {
		const desired = this.operations.get(entityId)?.desired;
		return desired ? clonePayload(desired) : undefined;
	}

	getPendingCount(): number {
		return this.operations.size;
	}

	confirm(entityId: string, light: LightState): boolean {
		const operation = this.operations.get(entityId);
		if (
			!operation ||
			operation.running ||
			!operation.awaitingConfirmation ||
			!matchesLightUpdate(light, operation.desired)
		) {
			return false;
		}
		const context = this.context(entityId, operation);
		this.clearConfirmationTimer(operation);
		this.operations.delete(entityId);
		this.callbacks.onSuccess?.(context);
		this.notifyChange();
		return true;
	}

	dispose(): void {
		this.disposed = true;
		for (const operation of this.operations.values()) {
			this.clearTimer(operation);
			this.clearConfirmationTimer(operation);
		}
		this.operations.clear();
	}

	private getOrCreate(entityId: string, request: Request): Operation {
		const existing = this.operations.get(entityId);
		if (existing) return existing;
		const operation: Operation = {
			generation: 0,
			desired: {},
			rollback: new Map(),
			running: false,
			runRequested: false,
			awaitingConfirmation: false,
			request,
		};
		this.operations.set(entityId, operation);
		return operation;
	}

	private clearTimer(operation: Operation): void {
		if (!operation.timer) return;
		this.scheduler.clearTimeout(operation.timer);
		operation.timer = undefined;
	}

	private clearConfirmationTimer(operation: Operation): void {
		if (!operation.confirmationTimer) return;
		this.scheduler.clearTimeout(operation.confirmationTimer);
		operation.confirmationTimer = undefined;
	}

	private armConfirmationDeadline(entityId: string, operation: Operation): void {
		this.clearConfirmationTimer(operation);
		const generation = operation.generation;
		operation.confirmationTimer = this.scheduler.setTimeout(() => {
			const current = this.operations.get(entityId);
			if (
				!current ||
				current.generation !== generation ||
				!current.awaitingConfirmation
			) {
				return;
			}
			current.confirmationTimer = undefined;
			this.operations.delete(entityId);
			this.callbacks.onError?.(
				new Error(
					`Home Assistant did not confirm ${current.request.label} within ${this.confirmationTimeoutMs}ms; showing server state`,
				),
				{
					...this.context(entityId, current),
					stale: false,
				},
			);
			this.notifyChange();
		}, this.confirmationTimeoutMs);
	}

	private start(entityId: string, operation: Operation): void {
		if (
			this.disposed ||
			operation.running ||
			!operation.runRequested ||
			operation.timer
		) {
			return;
		}
		operation.running = true;
		operation.runRequested = false;
		const generation = operation.generation;
		const payload = clonePayload(operation.desired);
		const request = operation.request;
		void this.execute(entityId, generation, payload, request);
	}

	private async execute(
		entityId: string,
		generation: number,
		payload: LightUpdatePayload,
		request: Request,
	): Promise<void> {
		try {
			await request.execute(payload);
		} catch (error) {
			this.handleRequestError(entityId, generation, request, error);
			return;
		}
		if (this.disposed) return;

		if (!this.isCurrent(entityId, generation)) {
			this.recordConfirmed(entityId, generation, payload);
			this.finishRun(entityId, generation);
			return;
		}

		try {
			await this.scheduler.wait(this.transitionMs);
			if (!this.isCurrent(entityId, generation)) {
				this.recordConfirmed(entityId, generation, payload);
				this.finishRun(entityId, generation);
				return;
			}

			const currentOperation = this.operations.get(entityId);
			if (!currentOperation) return;
			const confirmed = await request.afterSuccess(
				this.context(entityId, currentOperation),
			);
			if (!this.isCurrent(entityId, generation)) {
				this.recordConfirmed(entityId, generation, payload);
				this.finishRun(entityId, generation);
				return;
			}

			const operation = this.operations.get(entityId);
			if (!operation) return;
			this.recordConfirmed(entityId, generation, payload);
			const snapshotMatches =
				typeof confirmed === "object" &&
				confirmed !== null &&
				matchesLightUpdate(confirmed, operation.desired);
			if (
				confirmed === false ||
				(typeof confirmed === "object" && !snapshotMatches)
			) {
				operation.running = false;
				operation.awaitingConfirmation = true;
				this.armConfirmationDeadline(entityId, operation);
				this.notifyChange();
				return;
			}
			const context = this.context(entityId, operation);
			this.clearConfirmationTimer(operation);
			this.operations.delete(entityId);
			this.callbacks.onSuccess?.(context);
			this.notifyChange();
		} catch (error) {
			this.handlePostApplyError(entityId, generation, request, payload, error);
		}
	}

	private handleRequestError(
		entityId: string,
		generation: number,
		request: Request,
		error: unknown,
	): void {
		if (this.disposed) return;
		const operation = this.operations.get(entityId);
		const stale = !operation || operation.generation !== generation;
		if (!stale && operation) {
			this.operations.delete(entityId);
			this.callbacks.onRollback?.(entityId, rollbackFromMap(operation.rollback));
			this.notifyChange();
		}
		this.callbacks.onError?.(error, {
			entityId,
			generation,
			label: request.label,
			kind: request.kind,
			silent: request.silent,
			stale,
		});
		if (!stale) return;
		this.finishRun(entityId, generation);
	}

	private handlePostApplyError(
		entityId: string,
		generation: number,
		request: Request,
		payload: LightUpdatePayload,
		error: unknown,
	): void {
		if (this.disposed) return;
		const operation = this.operations.get(entityId);
		const stale = !operation || operation.generation !== generation;
		if (!stale && operation) {
			this.recordConfirmed(entityId, generation, payload);
			operation.running = false;
			operation.awaitingConfirmation = true;
			this.armConfirmationDeadline(entityId, operation);
			this.notifyChange();
		} else {
			this.recordConfirmed(entityId, generation, payload);
			this.finishRun(entityId, generation);
		}
		this.callbacks.onError?.(error, {
			entityId,
			generation,
			label: request.label,
			kind: request.kind,
			silent: request.silent,
			stale,
		});
	}

	private recordConfirmed(
		entityId: string,
		generation: number,
		payload: LightUpdatePayload,
	): void {
		const operation = this.operations.get(entityId);
		if (!operation || operation.generation !== generation) return;
		for (const field of fieldsOf(payload)) {
			operation.rollback.set(field, cloneValue(payload[field]));
		}
	}

	private finishRun(entityId: string, generation: number): void {
		const operation = this.operations.get(entityId);
		if (!operation || operation.generation < generation) return;
		operation.running = false;
		if (operation.runRequested && !operation.timer)
			this.start(entityId, operation);
		this.notifyChange();
	}

	private isCurrent(entityId: string, generation: number): boolean {
		return this.operations.get(entityId)?.generation === generation;
	}

	private context(entityId: string, operation: Operation): LightUpdateContext {
		return {
			entityId,
			generation: operation.generation,
			label: operation.request.label,
			kind: operation.request.kind,
			silent: operation.request.silent,
		};
	}

	private notifyChange(): void {
		if (!this.disposed) this.callbacks.onChange?.();
	}
}
