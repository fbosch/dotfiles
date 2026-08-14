import { describe, expect, test } from "bun:test";
import { createActor, SimulatedClock } from "xstate";
import { volumeIndicatorMachine } from "../machine";

function createTestActor() {
	const clock = new SimulatedClock();
	return {
		actor: createActor(volumeIndicatorMachine, { clock }).start(),
		clock,
	};
}

describe("volumeIndicatorMachine", () => {
	test("shows, fades, and hides automatically", () => {
		const { actor, clock } = createTestActor();
		actor.send({ type: "SHOW" });
		expect(actor.getSnapshot().matches("visible")).toBe(true);
		clock.increment(1500);
		expect(actor.getSnapshot().matches("hiding")).toBe(true);
		clock.increment(60);
		expect(actor.getSnapshot().matches("hidden")).toBe(true);
		actor.stop();
	});

	test("repeated show resets the display deadline", () => {
		const { actor, clock } = createTestActor();
		actor.send({ type: "SHOW" });
		clock.increment(1499);
		actor.send({ type: "SHOW" });
		clock.increment(1);
		expect(actor.getSnapshot().matches("visible")).toBe(true);
		clock.increment(1499);
		expect(actor.getSnapshot().matches("hiding")).toBe(true);
		actor.stop();
	});

	test("show during fade cancels the pending hide", () => {
		const { actor, clock } = createTestActor();
		actor.send({ type: "SHOW" });
		actor.send({ type: "HIDE" });
		actor.send({ type: "SHOW" });
		clock.increment(60);
		expect(actor.getSnapshot().matches("visible")).toBe(true);
		actor.stop();
	});
});
