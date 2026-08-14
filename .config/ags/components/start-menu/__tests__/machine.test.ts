import { describe, expect, test } from "bun:test";
import { createActor, SimulatedClock } from "xstate";
import { startMenuMachine } from "../machine";

function createTestActor() {
  const clock = new SimulatedClock();
  return {
    actor: createActor(startMenuMachine, { clock }).start(),
    clock,
  };
}

describe("startMenuMachine", () => {
  test("opens and hides the menu", () => {
    const { actor } = createTestActor();

    expect(actor.getSnapshot().matches("hidden")).toBe(true);
    actor.send({ type: "SHOW" });
    expect(actor.getSnapshot().matches({ visible: "recentClosed" })).toBe(true);
    actor.send({ type: "HIDE" });
    expect(actor.getSnapshot().matches("hidden")).toBe(true);

    actor.stop();
  });

  test("opens recent items immediately for keyboard and click requests", () => {
    const { actor } = createTestActor();
    actor.send({ type: "SHOW" });

    actor.send({ type: "RECENT_OPEN_NOW" });

    expect(actor.getSnapshot().matches({ visible: "recentOpen" })).toBe(true);
    actor.stop();
  });

  test("opens immediately while a hover delay is pending", () => {
    const { actor } = createTestActor();
    actor.send({ type: "SHOW" });
    actor.send({ type: "RECENT_OPEN_REQUEST" });

    actor.send({ type: "RECENT_OPEN_NOW" });

    expect(actor.getSnapshot().matches({ visible: "recentOpen" })).toBe(true);
    actor.stop();
  });

  test("completes delayed open and close transitions", () => {
    const { actor, clock } = createTestActor();
    actor.send({ type: "SHOW" });
    actor.send({ type: "RECENT_OPEN_REQUEST" });

    clock.increment(300);
    expect(actor.getSnapshot().matches({ visible: "recentOpen" })).toBe(true);

    actor.send({ type: "RECENT_CLOSE_REQUEST" });
    clock.increment(200);
    expect(actor.getSnapshot().matches({ visible: "recentClosed" })).toBe(true);
    actor.stop();
  });

  test("cancels a pending hover open when the pointer leaves", () => {
    const { actor, clock } = createTestActor();
    actor.send({ type: "SHOW" });

    actor.send({ type: "RECENT_OPEN_REQUEST" });
    expect(actor.getSnapshot().matches({ visible: "recentOpening" })).toBe(true);
    actor.send({ type: "RECENT_CLOSE_REQUEST" });

    expect(actor.getSnapshot().matches({ visible: "recentClosed" })).toBe(true);
    clock.increment(300);
    expect(actor.getSnapshot().matches({ visible: "recentClosed" })).toBe(true);
    actor.stop();
  });

  test("reopens recent items while a delayed close is pending", () => {
    const { actor, clock } = createTestActor();
    actor.send({ type: "SHOW" });
    actor.send({ type: "RECENT_OPEN_NOW" });

    actor.send({ type: "RECENT_CLOSE_REQUEST" });
    expect(actor.getSnapshot().matches({ visible: "recentClosing" })).toBe(true);
    actor.send({ type: "RECENT_OPEN_REQUEST" });

    expect(actor.getSnapshot().matches({ visible: "recentOpen" })).toBe(true);
    clock.increment(200);
    expect(actor.getSnapshot().matches({ visible: "recentOpen" })).toBe(true);
    actor.stop();
  });

  test("hiding the menu cancels submenu state", () => {
    const { actor } = createTestActor();
    actor.send({ type: "SHOW" });
    actor.send({ type: "RECENT_OPEN_NOW" });

    actor.send({ type: "HIDE" });

    expect(actor.getSnapshot().matches("hidden")).toBe(true);
    actor.stop();
  });

  test("stopping cancels pending delayed transitions", () => {
    const { actor, clock } = createTestActor();
    const clearedTimeouts: number[] = [];
    const clearTimeout = clock.clearTimeout.bind(clock);
    clock.clearTimeout = (id) => {
      clearedTimeouts.push(id);
      clearTimeout(id);
    };
    let emissions = 0;
    actor.subscribe(() => {
      emissions += 1;
    });
    actor.send({ type: "SHOW" });
    actor.send({ type: "RECENT_OPEN_REQUEST" });
    actor.stop();
    const emissionsAfterStop = emissions;

    clock.increment(300);

    expect(clearedTimeouts).toHaveLength(1);
    expect(emissions).toBe(emissionsAfterStop);
    expect(actor.getSnapshot().status).toBe("stopped");
  });
});
