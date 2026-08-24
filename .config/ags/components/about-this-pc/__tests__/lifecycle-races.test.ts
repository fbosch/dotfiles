import { describe, expect, test } from "bun:test";
import {
	createAboutThisPCLifecycle,
	type IsolatedUtilityProcess,
} from "../isolated-component";

function deferred() {
	let resolve = () => {};
	let reject = (_error: unknown) => {};
	const promise = new Promise<void>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return { promise, reject, resolve };
}

function request(
	lifecycle: ReturnType<typeof createAboutThisPCLifecycle>,
	action: string,
): Promise<string> {
	return new Promise((resolve) => {
		lifecycle.handleRequest([JSON.stringify({ action })], resolve);
	});
}

function createScheduler() {
	const pending: Array<() => void> = [];
	return {
		pending,
		fire() {
			pending.shift()?.();
		},
		schedule(callback: () => void) {
			pending.push(callback);
			return () => {
				const index = pending.indexOf(callback);
				if (index >= 0) pending.splice(index, 1);
			};
		},
	};
}

describe("About This PC lifecycle races", () => {
	test("retries intent preparation after a failed attempt", async () => {
		const originalError = console.error;
		console.error = () => {};
		const firstReady = deferred();
		const firstCompletion = deferred();
		const scheduler = createScheduler();
		let launches = 0;
		const lifecycle = createAboutThisPCLifecycle({
			launch: () => {
				launches += 1;
				if (launches > 1) {
					return {
						ready: Promise.resolve(),
						completion: new Promise<void>(() => {}),
						request: () => Promise.resolve(),
						stop: () => Promise.resolve(),
						terminate() {},
					};
				}
				return {
					ready: firstReady.promise,
					completion: firstCompletion.promise,
					request: () => Promise.resolve(),
					stop: () => {
						firstCompletion.resolve();
						return Promise.resolve();
					},
					terminate() {},
				};
			},
			schedule: scheduler.schedule,
		});

		try {
			lifecycle.intentStart("start-menu:pointer");
			firstReady.reject(new Error("fixture startup failure"));
			await firstCompletion.promise;
			await new Promise((resolve) => setTimeout(resolve, 0));
			lifecycle.intentEnd("start-menu:pointer");
			expect(scheduler.pending).toHaveLength(0);
			lifecycle.intentStart("start-menu:pointer");
			expect(launches).toBe(2);
		} finally {
			console.error = originalError;
		}
	});

	test("does not launch an unclaimed successor after a slow stop", async () => {
		const scheduler = createScheduler();
		const firstCompletion = deferred();
		let launches = 0;
		const lifecycle = createAboutThisPCLifecycle({
			launch: (): IsolatedUtilityProcess => {
				launches += 1;
				return {
					ready: Promise.resolve(),
					completion: launches === 1
						? firstCompletion.promise
						: new Promise<void>(() => {}),
					request: () => Promise.resolve(),
					stop: () => Promise.resolve(),
					terminate() {},
				};
			},
			schedule: scheduler.schedule,
		});

		lifecycle.intentStart("start-menu:pointer");
		lifecycle.intentEnd("start-menu:pointer");
		scheduler.fire();
		lifecycle.intentStart("start-menu:pointer");
		lifecycle.intentEnd("start-menu:pointer");
		scheduler.fire();
		firstCompletion.resolve();
		await firstCompletion.promise;
		await Promise.resolve();
		await Promise.resolve();
		expect(launches).toBe(1);
	});

	test("late failed preparation cannot clear successor visibility", async () => {
		const firstReady = deferred();
		const firstCompletion = deferred();
		let launches = 0;
		let successorStops = 0;
		const lifecycle = createAboutThisPCLifecycle({
			launch: () => {
				launches += 1;
				if (launches === 1) {
					return {
						ready: firstReady.promise,
						completion: firstCompletion.promise,
						request: () => Promise.resolve(),
						stop: () => Promise.resolve(),
						terminate() {},
					};
				}
				return {
					ready: Promise.resolve(),
					completion: new Promise<void>(() => {}),
					request: () => Promise.resolve(),
					stop: () => {
						successorStops += 1;
						return Promise.resolve();
					},
					terminate() {},
				};
			},
			schedule: () => () => {},
		});

		lifecycle.intentStart("start-menu:pointer");
		firstCompletion.resolve();
		await firstCompletion.promise;
		await Promise.resolve();
		await expect(request(lifecycle, "show")).resolves.toBe("shown");
		firstReady.reject(new Error("late fixture readiness failure"));
		await Promise.resolve();
		await expect(request(lifecycle, "is-visible")).resolves.toBe("true");
		expect(successorStops).toBe(0);
	});

	for (const action of ["hide", "destroy"] as const) {
		test(`${action} invalidates preparation so reentry prepares again`, async () => {
			const completions = [deferred(), deferred()];
			let launches = 0;
			const lifecycle = createAboutThisPCLifecycle({
				launch: () => {
					const completion = completions[launches];
					launches += 1;
					return {
						ready: Promise.resolve(),
						completion: completion?.promise ?? new Promise<void>(() => {}),
						request: () => Promise.resolve(),
						stop: () => {
							completion?.resolve();
							return Promise.resolve();
						},
						terminate() {},
					};
				},
				schedule: () => () => {},
			});

			lifecycle.intentStart("start-menu:pointer");
			await expect(request(lifecycle, action)).resolves.toBe(
				action === "hide" ? "hidden" : "destroyed",
			);
			lifecycle.intentEnd("start-menu:pointer");
			lifecycle.intentStart("start-menu:pointer");
			expect(launches).toBe(2);
		});
	}
});
