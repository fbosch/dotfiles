import { describe, expect, test } from "bun:test";
import { createUtilityPrefetch } from "../utility-prefetch";

function createScheduler() {
	const pending: Array<() => void> = [];
	return {
		pending,
		schedule(callback: () => void) {
			pending.push(callback);
			return () => {
				const index = pending.indexOf(callback);
				if (index >= 0) pending.splice(index, 1);
			};
		},
	};
}

describe("utility prefetch", () => {
	test("prepares once across overlapping pointer and focus intent", () => {
		const scheduler = createScheduler();
		const events: string[] = [];
		const prefetch = createUtilityPrefetch({
			prepare: (id: string) => events.push(`prepare:${id}`),
			cancel: (id) => events.push(`cancel:${id}`),
			activate: (id) => events.push(`activate:${id}`),
			schedule: scheduler.schedule,
		});

		prefetch.intentStart("about");
		prefetch.intentStart("about");
		prefetch.intentEnd("about");

		expect(events).toEqual(["prepare:about"]);
		expect(scheduler.pending).toHaveLength(0);
	});

	test("cancels an unused preparation after the release delay", () => {
		const scheduler = createScheduler();
		const events: string[] = [];
		const prefetch = createUtilityPrefetch({
			prepare: (id: string) => events.push(`prepare:${id}`),
			cancel: (id) => events.push(`cancel:${id}`),
			activate: (id) => events.push(`activate:${id}`),
			schedule: scheduler.schedule,
		});

		prefetch.intentStart("about");
		prefetch.intentEnd("about");
		expect(events).toEqual(["prepare:about"]);
		scheduler.pending[0]?.();
		expect(events).toEqual(["prepare:about", "cancel:about"]);
	});

	test("reentry and activation cancel pending disposal", () => {
		const scheduler = createScheduler();
		const events: string[] = [];
		const prefetch = createUtilityPrefetch({
			prepare: (id: string) => events.push(`prepare:${id}`),
			cancel: (id) => events.push(`cancel:${id}`),
			activate: (id) => events.push(`activate:${id}`),
			schedule: scheduler.schedule,
		});

		prefetch.intentStart("about");
		prefetch.intentEnd("about");
		prefetch.intentStart("about");
		expect(scheduler.pending).toHaveLength(0);
		prefetch.activate("about");
		expect(events).toEqual(["prepare:about", "activate:about"]);
		prefetch.intentEnd("about");
		expect(scheduler.pending).toHaveLength(0);
	});

	test("clears overlapping intent when the owning surface hides", () => {
		const scheduler = createScheduler();
		const events: string[] = [];
		const prefetch = createUtilityPrefetch({
			prepare: (id: string) => events.push(`prepare:${id}`),
			cancel: (id) => events.push(`cancel:${id}`),
			activate: (id) => events.push(`activate:${id}`),
			schedule: scheduler.schedule,
		});

		prefetch.intentStart("about");
		prefetch.intentStart("about");
		prefetch.intentClear("about");
		expect(scheduler.pending).toHaveLength(1);
		scheduler.pending[0]?.();
		expect(events).toEqual(["prepare:about", "cancel:about"]);
	});
});
