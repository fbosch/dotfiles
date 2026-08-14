import { describe, expect, test } from "bun:test";
import { createActor, SimulatedClock } from "xstate";
import { keyboardSwitcherMachine } from "../machine";

const config = {
	layouts: ["EN", "DA"],
	activeLayout: "DA",
	size: "sm" as const,
};

function createTestActor() {
	const clock = new SimulatedClock();
	return {
		actor: createActor(keyboardSwitcherMachine, { clock }).start(),
		clock,
	};
}

describe("keyboardSwitcherMachine", () => {
	test("shows, fades, and hides automatically", () => {
		const { actor, clock } = createTestActor();
		actor.send({ type: "SHOW", config });
		expect(actor.getSnapshot().matches("visible")).toBe(true);
		expect(actor.getSnapshot().hasTag("switcher-visible")).toBe(true);
		clock.increment(700);
		expect(actor.getSnapshot().matches("hiding")).toBe(true);
		expect(actor.getSnapshot().hasTag("switcher-visible")).toBe(true);
		clock.increment(60);
		expect(actor.getSnapshot().matches("hidden")).toBe(true);
		actor.stop();
	});

	test("a repeated show resets the auto-hide deadline", () => {
		const { actor, clock } = createTestActor();
		actor.send({ type: "SHOW", config });
		clock.increment(699);
		actor.send({
			type: "SHOW",
			config: { ...config, activeLayout: "EN" },
		});
		clock.increment(1);
		expect(actor.getSnapshot().matches("visible")).toBe(true);
		expect(actor.getSnapshot().context.config.activeLayout).toBe("EN");
		clock.increment(699);
		expect(actor.getSnapshot().matches("hiding")).toBe(true);
		actor.stop();
	});

	test("show during fade-out cancels the pending hide", () => {
		const { actor, clock } = createTestActor();
		actor.send({ type: "SHOW", config });
		actor.send({ type: "HIDE" });
		expect(actor.getSnapshot().matches("hiding")).toBe(true);
		actor.send({ type: "SHOW", config });
		clock.increment(60);
		expect(actor.getSnapshot().matches("visible")).toBe(true);
		actor.stop();
	});

	test("stopping clears delayed transitions", () => {
		const { actor, clock } = createTestActor();
		const cleared: number[] = [];
		const clearTimeout = clock.clearTimeout.bind(clock);
		clock.clearTimeout = (id) => {
			cleared.push(id);
			clearTimeout(id);
		};
		actor.send({ type: "SHOW", config });
		actor.stop();
		clock.increment(700);
		expect(cleared).toHaveLength(1);
		expect(actor.getSnapshot().status).toBe("stopped");
	});
});
