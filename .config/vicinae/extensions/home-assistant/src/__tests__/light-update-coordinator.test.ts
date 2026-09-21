import assert from "node:assert/strict";
import test from "node:test";
import {
	applyLightUpdate,
	type LightUpdateContext,
	LightUpdateCoordinator,
	type LightUpdateScheduler,
} from "../light-update-coordinator.ts";
import type { LightState } from "../types.ts";

const makeLight = (entityId: string, brightness = 25): LightState => ({
	entity_id: entityId,
	state: "on",
	attributes: {
		brightness,
		friendly_name: entityId,
	},
	last_changed: "2026-01-01T00:00:00.000Z",
	last_updated: "2026-01-01T00:00:00.000Z",
});

const wait = (milliseconds: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (condition()) return;
		await wait(2);
	}
	assert.fail("Timed out waiting for coordinator state");
}

type FakeTimer = {
	callback: () => void;
	dueAt: number;
	cancelled: boolean;
};

function createScheduler(): {
	scheduler: LightUpdateScheduler;
	advance: (milliseconds: number) => void;
} {
	let now = 0;
	const timers = new Set<FakeTimer>();
	const runDueTimers = () => {
		for (const timer of [...timers]) {
			if (timer.cancelled || timer.dueAt > now) continue;
			timers.delete(timer);
			timer.callback();
		}
	};
	return {
		scheduler: {
			setTimeout: (callback, delay) => {
				const timer = { callback, dueAt: now + delay, cancelled: false };
				timers.add(timer);
				return timer;
			},
			clearTimeout: (timer) => {
				if (typeof timer !== "number") (timer as FakeTimer).cancelled = true;
			},
			wait: async (delay) => {
				now += delay;
				runDueTimers();
			},
		},
		advance: (milliseconds) => {
			now += milliseconds;
			runDueTimers();
		},
	};
}

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

const successAfterRefresh =
	(): ((
		context: LightUpdateContext,
	) => Promise<boolean | LightState | undefined>) =>
	async (_context) =>
		true;

test("debounced brightness keeps the latest desired value and coalesces rapid updates", async () => {
	const calls: number[] = [];
	const coordinator = new LightUpdateCoordinator({
		debounceMs: 8,
		transitionMs: 0,
	});
	const light = makeLight("light.kitchen", 25);

	coordinator.submitSettings(
		"light.kitchen",
		light,
		{ brightness: 100 },
		{
			debounce: true,
			label: "Kitchen",
			execute: async (payload) => {
				calls.push(payload.brightness ?? -1);
			},
			afterSuccess: successAfterRefresh(),
		},
	);
	coordinator.submitSettings(
		"light.kitchen",
		light,
		{ brightness: 200 },
		{
			debounce: true,
			label: "Kitchen",
			execute: async (payload) => {
				calls.push(payload.brightness ?? -1);
			},
			afterSuccess: successAfterRefresh(),
		},
	);

	assert.deepEqual(coordinator.getDesired("light.kitchen"), { brightness: 200 });
	assert.equal(coordinator.getPendingCount(), 1);
	await waitFor(() => calls.length === 1 && coordinator.getPendingCount() === 0);
	assert.deepEqual(calls, [200]);
	coordinator.dispose();
});

test("a newer explicit action cancels a late brightness debounce", async () => {
	const calls: string[] = [];
	const coordinator = new LightUpdateCoordinator({
		debounceMs: 12,
		transitionMs: 0,
	});
	const light = makeLight("light.office");

	coordinator.submitSettings(
		"light.office",
		light,
		{ brightness: 200 },
		{
			debounce: true,
			label: "Office",
			execute: async () => {
				calls.push("brightness");
			},
			afterSuccess: successAfterRefresh(),
		},
	);
	coordinator.submitAction("light.office", {
		label: "Light turned off",
		execute: async () => {
			calls.push("off");
		},
		afterSuccess: successAfterRefresh(),
	});

	await waitFor(() => calls.length === 1 && coordinator.getPendingCount() === 0);
	assert.deepEqual(calls, ["off"]);
	coordinator.dispose();
});

test("immediate failures roll back only the current entity and report silent errors", async () => {
	const rollbacks: Array<{ entityId: string; brightness?: number }> = [];
	const errors: Array<{ context: LightUpdateContext & { stale: boolean } }> = [];
	const coordinator = new LightUpdateCoordinator({
		transitionMs: 0,
		callbacks: {
			onRollback: (entityId, rollback) =>
				rollbacks.push({ entityId, ...rollback }),
			onError: (_error, context) => errors.push({ context }),
		},
	});

	coordinator.submitSettings(
		"light.bedroom",
		makeLight("light.bedroom", 10),
		{ brightness: 220 },
		{
			label: "Bedroom",
			silent: true,
			execute: async () => {
				throw new Error("request failed");
			},
			afterSuccess: successAfterRefresh(),
		},
	);
	coordinator.submitSettings(
		"light.kitchen",
		makeLight("light.kitchen", 30),
		{ brightness: 180 },
		{
			label: "Kitchen",
			execute: async () => undefined,
			afterSuccess: successAfterRefresh(),
		},
	);

	await waitFor(
		() => errors.length === 1 && coordinator.getPendingCount() === 0,
	);
	assert.deepEqual(rollbacks, [{ entityId: "light.bedroom", brightness: 10 }]);
	assert.equal(errors[0]?.context.silent, true);
	coordinator.dispose();
});

test("a stale failure cannot roll back a newer update on the same entity", async () => {
	const rollbacks: string[] = [];
	const errors: Array<LightUpdateContext & { stale: boolean }> = [];
	let rejectFirst!: (reason?: unknown) => void;
	let resolveSecond!: () => void;
	const firstRequest = new Promise<void>((_resolve, reject) => {
		rejectFirst = reject;
	});
	const secondRequest = new Promise<void>((resolve) => {
		resolveSecond = resolve;
	});
	let calls = 0;
	const coordinator = new LightUpdateCoordinator({
		transitionMs: 0,
		callbacks: {
			onRollback: (entityId) => rollbacks.push(entityId),
			onError: (_error, context) => errors.push(context),
		},
	});
	const light = makeLight("light.living_room", 10);

	coordinator.submitSettings(
		"light.living_room",
		light,
		{ brightness: 100 },
		{
			label: "Living room",
			execute: async () => {
				calls += 1;
				await firstRequest;
			},
			afterSuccess: successAfterRefresh(),
		},
	);
	coordinator.submitSettings(
		"light.living_room",
		light,
		{ brightness: 180 },
		{
			label: "Living room",
			execute: async () => {
				calls += 1;
				await secondRequest;
			},
			afterSuccess: successAfterRefresh(),
		},
	);

	rejectFirst(new Error("old request failed"));
	await waitFor(() => calls === 2);
	assert.deepEqual(rollbacks, []);
	assert.equal(errors.length, 1);
	assert.equal(coordinator.getPendingCount(), 1);
	resolveSecond();
	await waitFor(() => coordinator.getPendingCount() === 0);
	assert.deepEqual(rollbacks, []);
	coordinator.dispose();
});

test("a later failure rolls back to the latest confirmed operation", async () => {
	const rollbacks: Array<{ brightness?: number }> = [];
	const errors: unknown[] = [];
	const coordinator = new LightUpdateCoordinator({
		transitionMs: 0,
		callbacks: {
			onRollback: (_entityId, rollback) => rollbacks.push(rollback),
			onError: (error) => errors.push(error),
		},
	});
	const light = makeLight("light.den", 20);

	coordinator.submitSettings(
		"light.den",
		light,
		{ brightness: 180 },
		{
			label: "Den",
			execute: async () => undefined,
			afterSuccess: async () => false,
		},
	);
	await wait(5);
	coordinator.submitSettings(
		"light.den",
		applyLightUpdate(light, { brightness: 180 }),
		{ hs_color: [90, 50] },
		{
			label: "Den",
			execute: async () => {
				throw new Error("color request failed");
			},
			afterSuccess: successAfterRefresh(),
		},
	);

	await waitFor(
		() => errors.length === 1 && coordinator.getPendingCount() === 0,
	);
	assert.equal(rollbacks[0]?.brightness, 180);
	coordinator.dispose();
});

test("optimistic state survives an unconfirmed refresh until polling confirms it", async () => {
	let successCount = 0;
	const coordinator = new LightUpdateCoordinator({
		transitionMs: 0,
		callbacks: {
			onSuccess: () => {
				successCount += 1;
			},
		},
	});
	const light = makeLight("light.hall", 20);

	coordinator.submitSettings(
		"light.hall",
		light,
		{ brightness: 180 },
		{
			label: "Hall",
			execute: async () => undefined,
			afterSuccess: async () => false,
		},
	);
	await waitFor(() => coordinator.getPendingCount() === 1);
	assert.deepEqual(
		applyLightUpdate(light, coordinator.getDesired("light.hall") ?? {}),
		{
			...light,
			attributes: { ...light.attributes, brightness: 180 },
		},
	);
	await wait(5);
	assert.equal(coordinator.confirm("light.hall", light), false);
	assert.equal(
		coordinator.confirm(
			"light.hall",
			applyLightUpdate(light, { brightness: 180 }),
		),
		true,
	);
	assert.equal(successCount, 1);
	assert.equal(coordinator.getPendingCount(), 0);
	coordinator.dispose();
});

test("an immediate refresh snapshot confirms without a later polling change", async () => {
	let successCount = 0;
	const clock = createScheduler();
	const coordinator = new LightUpdateCoordinator({
		transitionMs: 0,
		confirmationTimeoutMs: 20,
		scheduler: clock.scheduler,
		callbacks: { onSuccess: () => (successCount += 1) },
	});
	const light = makeLight("light.snapshot", 20);

	coordinator.submitSettings(
		"light.snapshot",
		light,
		{ brightness: 180 },
		{
			label: "Snapshot",
			execute: async () => undefined,
			afterSuccess: async () => applyLightUpdate(light, { brightness: 180 }),
		},
	);

	await flushMicrotasks();
	assert.equal(successCount, 1);
	coordinator.dispose();
});

test("an unconfirmed update times out without rolling back the successful service call", async () => {
	const errors: unknown[] = [];
	let rollbackCount = 0;
	const clock = createScheduler();
	const coordinator = new LightUpdateCoordinator({
		transitionMs: 0,
		confirmationTimeoutMs: 12,
		scheduler: clock.scheduler,
		callbacks: {
			onError: (error) => errors.push(error),
			onRollback: () => (rollbackCount += 1),
		},
	});
	const light = makeLight("light.missing_brightness");

	coordinator.submitSettings(
		"light.missing_brightness",
		light,
		{ brightness: 0 },
		{
			label: "Missing brightness",
			execute: async () => undefined,
			afterSuccess: async () => false,
		},
	);

	await flushMicrotasks();
	assert.equal(coordinator.getPendingCount(), 1);
	assert.equal(
		coordinator.confirm("light.missing_brightness", {
			...light,
			attributes: { ...light.attributes, brightness: undefined },
		}),
		false,
	);
	clock.advance(12);
	await flushMicrotasks();
	assert.equal(errors.length, 1);
	assert.equal(coordinator.getPendingCount(), 0);
	assert.equal(rollbackCount, 0);
	assert.match(String(errors[0]), /did not confirm/);
	coordinator.dispose();
});

test("near-matching polling confirms rounded brightness and color values", async () => {
	const clock = createScheduler();
	const coordinator = new LightUpdateCoordinator({
		transitionMs: 0,
		confirmationTimeoutMs: 30,
		scheduler: clock.scheduler,
	});
	const light = makeLight("light.rounded", 20);
	coordinator.submitSettings(
		"light.rounded",
		light,
		{
			brightness: 180,
			hs_color: [90, 50],
		},
		{
			label: "Rounded",
			execute: async () => undefined,
			afterSuccess: async () => false,
		},
	);

	await flushMicrotasks();
	clock.advance(5);
	assert.equal(
		coordinator.confirm("light.rounded", {
			...light,
			attributes: { ...light.attributes, brightness: 182, hs_color: [90.5, 49.5] },
		}),
		false,
	);
	assert.equal(
		coordinator.confirm("light.rounded", {
			...light,
			attributes: { ...light.attributes, brightness: 181, hs_color: [90.5, 49.5] },
		}),
		true,
	);
	assert.equal(coordinator.getPendingCount(), 0);
	coordinator.dispose();
});

test("confirmation deadlines are cleared when superseded or disposed", async () => {
	const supersededErrors: unknown[] = [];
	const supersededClock = createScheduler();
	const superseded = new LightUpdateCoordinator({
		transitionMs: 0,
		confirmationTimeoutMs: 10,
		scheduler: supersededClock.scheduler,
		callbacks: { onError: (error) => supersededErrors.push(error) },
	});
	const light = makeLight("light.superseded");
	superseded.submitSettings(
		"light.superseded",
		light,
		{ brightness: 180 },
		{
			label: "Superseded",
			execute: async () => undefined,
			afterSuccess: async () => false,
		},
	);
	await flushMicrotasks();
	superseded.submitAction("light.superseded", {
		label: "Turned off",
		execute: async () => undefined,
		afterSuccess: async () => true,
	});
	await flushMicrotasks();
	supersededClock.advance(20);
	await flushMicrotasks();
	assert.deepEqual(supersededErrors, []);
	superseded.dispose();

	const disposedErrors: unknown[] = [];
	const disposedClock = createScheduler();
	const disposed = new LightUpdateCoordinator({
		transitionMs: 0,
		confirmationTimeoutMs: 10,
		scheduler: disposedClock.scheduler,
		callbacks: { onError: (error) => disposedErrors.push(error) },
	});
	disposed.submitSettings(
		"light.disposed",
		makeLight("light.disposed"),
		{ brightness: 180 },
		{
			label: "Disposed",
			execute: async () => undefined,
			afterSuccess: async () => false,
		},
	);
	await flushMicrotasks();
	disposed.dispose();
	disposedClock.advance(20);
	await flushMicrotasks();
	assert.deepEqual(disposedErrors, []);
});
