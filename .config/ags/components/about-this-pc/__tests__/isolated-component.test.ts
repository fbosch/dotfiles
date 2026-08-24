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
	test("prepares a hidden process and reuses it on show", async () => {
		let launches = 0;
		let showRequests = 0;
		const completion = deferred();
		const component = createIsolatedAboutThisPCComponent({
			launch: () => {
				launches += 1;
				return {
					ready: Promise.resolve(),
					completion: completion.promise,
					request: () => {
						showRequests += 1;
						return Promise.resolve();
					},
					stop: () => Promise.resolve(),
					terminate() {},
				};
			},
		});

		component.init();
		await expect(request(component, "prepare")).resolves.toBe("prepared");
		expect(launches).toBe(1);
		expect(showRequests).toBe(0);
		await expect(request(component, "is-visible")).resolves.toBe("false");
		await expect(request(component, "show")).resolves.toBe("shown");
		expect(launches).toBe(1);
		expect(showRequests).toBe(1);
	});

	test("stops an unused prepared process", async () => {
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
		await request(component, "prepare");
		await expect(request(component, "cancel-prepare")).resolves.toBe("cancelled");
		expect(stops).toBe(1);
	});

	test("activation wins over concurrent preparation cancellation", async () => {
		const completion = deferred();
		const showRequest = deferred();
		let stops = 0;
		const component = createIsolatedAboutThisPCComponent({
			launch: () => ({
				ready: Promise.resolve(),
				completion: completion.promise,
				request: () => showRequest.promise,
				stop: () => {
					stops += 1;
					completion.resolve();
					return Promise.resolve();
				},
				terminate() {},
			}),
		});

		component.init();
		await request(component, "prepare");
		const showing = request(component, "show");
		await expect(request(component, "cancel-prepare")).resolves.toBe("cancelled");
		expect(stops).toBe(0);
		showRequest.resolve();
		await expect(showing).resolves.toBe("shown");
		await expect(request(component, "is-visible")).resolves.toBe("true");
	});

	test("does not commit visibility after the process exits", async () => {
		const originalError = console.error;
		console.error = () => {};
		const completion = deferred();
		const showRequest = deferred();
		const component = createIsolatedAboutThisPCComponent({
			launch: () => ({
				ready: Promise.resolve(),
				completion: completion.promise,
				request: () => showRequest.promise,
				stop: () => Promise.resolve(),
				terminate() {},
			}),
		});

		try {
			component.init();
			const showing = request(component, "show");
			completion.resolve();
			await completion.promise;
			await Promise.resolve();
			showRequest.resolve();
			await expect(showing).resolves.toBe("error: utility unavailable");
			await expect(request(component, "is-visible")).resolves.toBe("false");
		} finally {
			console.error = originalError;
		}
	});

	test("stops a hidden process after its final show claim fails", async () => {
		const originalError = console.error;
		console.error = () => {};
		const completion = deferred();
		let stops = 0;
		const component = createIsolatedAboutThisPCComponent({
			launch: () => ({
				ready: Promise.resolve(),
				completion: completion.promise,
				request: () => Promise.reject(new Error("show failed")),
				stop: () => {
					stops += 1;
					completion.resolve();
					return Promise.resolve();
				},
				terminate() {},
			}),
		});

		try {
			component.init();
			await request(component, "prepare");
			await expect(request(component, "show")).resolves.toBe(
				"error: utility unavailable",
			);
			expect(stops).toBe(1);
			await expect(request(component, "is-visible")).resolves.toBe("false");
		} finally {
			console.error = originalError;
		}
	});

	test("preserves the show failure when cleanup also fails", async () => {
		const originalError = console.error;
		const errors: unknown[][] = [];
		console.error = (...args: unknown[]) => errors.push(args);
		const completion = deferred();
		const component = createIsolatedAboutThisPCComponent({
			launch: () => ({
				ready: Promise.resolve(),
				completion: completion.promise,
				request: () => Promise.reject(new Error("show failed")),
				stop: () => {
					completion.resolve();
					return Promise.reject(new Error("stop failed"));
				},
				terminate() {},
			}),
		});

		try {
			component.init();
			await expect(request(component, "show")).resolves.toBe(
				"error: utility unavailable",
			);
			expect(errors).toHaveLength(2);
			expect(String(errors[0]?.[1])).toContain("stop failed");
			expect(String(errors[1]?.[1])).toContain("show failed");
		} finally {
			console.error = originalError;
		}
	});

	test("keeps the process when one of concurrent show claims succeeds", async () => {
		const originalError = console.error;
		console.error = () => {};
		const completion = deferred();
		let requests = 0;
		let stops = 0;
		const component = createIsolatedAboutThisPCComponent({
			launch: () => ({
				ready: Promise.resolve(),
				completion: completion.promise,
				request: () => {
					requests += 1;
					return requests === 1
						? Promise.resolve()
						: Promise.reject(new Error("duplicate show failed"));
				},
				stop: () => {
					stops += 1;
					completion.resolve();
					return Promise.resolve();
				},
				terminate() {},
			}),
		});

		try {
			component.init();
			const results = await Promise.all([
				request(component, "show"),
				request(component, "show"),
			]);
			expect(results).toEqual(["shown", "error: utility unavailable"]);
			expect(stops).toBe(0);
			await expect(request(component, "is-visible")).resolves.toBe("true");
		} finally {
			console.error = originalError;
		}
	});

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
