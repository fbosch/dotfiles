import { describe, expect, test } from "bun:test";
import {
	createIsolatedAboutThisPCComponent,
	type IsolatedUtilityProcess,
} from "../isolated-component";

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

function request(
	component: ReturnType<typeof createIsolatedAboutThisPCComponent>,
	action: string,
): Promise<string> {
	return new Promise((resolve) => {
		component.handleRequest([JSON.stringify({ action })], resolve);
	});
}

describe("isolated About This PC component", () => {
	test("deduplicates startup and reports visibility only after readiness", async () => {
		const ready = deferred();
		const completion = deferred();
		let launches = 0;
		let requests = 0;
		const process: IsolatedUtilityProcess = {
			ready: ready.promise,
			completion: completion.promise,
			request: () => {
				requests += 1;
				return Promise.resolve();
			},
			stop: () => Promise.resolve(),
			terminate() {},
		};
		const component = createIsolatedAboutThisPCComponent({
			launch: () => {
				launches += 1;
				return process;
			},
		});

		component.init();
		const first = request(component, "show");
		const second = request(component, "show");
		expect(launches).toBe(1);
		await expect(request(component, "is-visible")).resolves.toBe("false");
		ready.resolve();
		await expect(Promise.all([first, second])).resolves.toEqual(["shown", "shown"]);
		expect(requests).toBe(2);
		await expect(request(component, "is-visible")).resolves.toBe("true");
		await expect(request(component, "show")).resolves.toBe("shown");
		expect(requests).toBe(3);

		completion.resolve();
		await completion.promise;
		await Promise.resolve();
		await expect(request(component, "is-visible")).resolves.toBe("false");
	});

	test("waits for process termination before completing hide", async () => {
		const completion = deferred();
		let stops = 0;
		const component = createIsolatedAboutThisPCComponent({
			launch: () => ({
				ready: Promise.resolve(),
				completion: completion.promise,
				request: () => Promise.resolve(),
				stop: () => {
					stops += 1;
					completion.resolve();
					return Promise.resolve();
				},
				terminate() {},
			}),
		});

		component.init();
		await expect(request(component, "show")).resolves.toBe("shown");
		await expect(request(component, "hide")).resolves.toBe("hidden");
		expect(stops).toBe(1);
		await expect(request(component, "is-visible")).resolves.toBe("false");
	});

	test("terminates its owned process synchronously during host shutdown", async () => {
		let shutdown = () => {};
		let terminations = 0;
		const component = createIsolatedAboutThisPCComponent({
			launch: () => ({
				ready: Promise.resolve(),
				completion: new Promise<void>(() => {}),
				request: () => Promise.resolve(),
				stop: () => Promise.resolve(),
				terminate: () => {
					terminations += 1;
				},
			}),
			onShutdown: (callback) => {
				shutdown = callback;
			},
		});

		component.init();
		await request(component, "show");
		shutdown();
		expect(terminations).toBe(1);
		await expect(request(component, "is-visible")).resolves.toBe("false");
	});

	test("restarts after the isolated process exits", async () => {
		const completions = [deferred(), deferred()];
		let launches = 0;
		const component = createIsolatedAboutThisPCComponent({
			launch: () => {
				const completion = completions[launches];
				launches += 1;
				return {
					ready: Promise.resolve(),
					completion: completion?.promise ?? Promise.resolve(),
					request: () => Promise.resolve(),
					stop: () => Promise.resolve(),
					terminate() {},
				};
			},
		});

		component.init();
		await request(component, "show");
		completions[0]?.resolve();
		await completions[0]?.promise;
		await Promise.resolve();
		await expect(request(component, "show")).resolves.toBe("shown");
		expect(launches).toBe(2);
	});

	test("finishes failed-start cleanup before allowing a retry", async () => {
		const originalError = console.error;
		console.error = () => {};
		const firstReady = Promise.withResolvers<void>();
		const firstCompletion = deferred();
		let launches = 0;
		let stops = 0;
		const component = createIsolatedAboutThisPCComponent({
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
						stops += 1;
						firstCompletion.resolve();
						return Promise.resolve();
					},
					terminate() {},
				};
			},
		});

		try {
			component.init();
			const failedShow = request(component, "show");
			firstReady.reject(new Error("startup failed"));
			await expect(failedShow).resolves.toBe("error: utility unavailable");
			expect(stops).toBe(1);
			await expect(request(component, "show")).resolves.toBe("shown");
			expect(launches).toBe(2);
		} finally {
			console.error = originalError;
		}
	});

	test("reports launch failures without claiming visibility", async () => {
		const originalError = console.error;
		console.error = () => {};
		const component = createIsolatedAboutThisPCComponent({
			launch: () => {
				throw new Error("unavailable");
			},
		});

		try {
			component.init();
			await expect(request(component, "show")).resolves.toBe(
				"error: utility unavailable",
			);
			await expect(request(component, "is-visible")).resolves.toBe("false");
		} finally {
			console.error = originalError;
		}
	});
});
