import { describe, expect, test } from "bun:test";
import { createActor, SimulatedClock } from "xstate";
import { confirmDialogMachine } from "../machine";

function createTestActor() {
	const clock = new SimulatedClock();
	return {
		actor: createActor(confirmDialogMachine, { clock }).start(),
		clock,
	};
}

describe("confirmDialogMachine", () => {
	test("shows immediately without a delay", () => {
		const { actor } = createTestActor();
		actor.send({ type: "SHOW", delayMs: 0 });
		expect(actor.getSnapshot().matches("visible")).toBe(true);
		actor.stop();
	});

	test("owns delayed show and cancellation", () => {
		const { actor, clock } = createTestActor();
		actor.send({ type: "SHOW", delayMs: 180 });
		expect(actor.getSnapshot().matches("pending")).toBe(true);
		clock.increment(179);
		expect(actor.getSnapshot().matches("pending")).toBe(true);
		actor.send({ type: "HIDE" });
		clock.increment(1);
		expect(actor.getSnapshot().matches("hidden")).toBe(true);
		actor.stop();
	});

	test("ignores replacement shows while active", () => {
		const { actor, clock } = createTestActor();
		actor.send({ type: "SHOW", delayMs: 180 });
		actor.send({ type: "SHOW", delayMs: 0 });
		expect(actor.getSnapshot().matches("pending")).toBe(true);
		clock.increment(180);
		expect(actor.getSnapshot().matches("visible")).toBe(true);
		actor.stop();
	});
});
