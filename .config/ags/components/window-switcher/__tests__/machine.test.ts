import { describe, expect, test } from "bun:test";
import { createActor } from "xstate";
import { windowSwitcherMachine } from "../machine";

const windows = [
  { address: "0x1", class: "One", title: "One", workspace: "1" },
  { address: "0x2", class: "Two", title: "Two", workspace: "2" },
  {
    address: "0x3",
    class: "Three",
    title: "Three",
    workspace: "special:minimized",
  },
];

function createTestActor() {
  return createActor(windowSwitcherMachine).start();
}

describe("windowSwitcherMachine", () => {
  test("starts hidden and activates a switcher session", () => {
    const actor = createTestActor();

    actor.send({
      type: "ACTIVATE",
      windows,
      index: 1,
      triggerModifier: "SUPER",
    });

    expect(actor.getSnapshot().hasTag("switcher-visible")).toBe(true);
    expect(actor.getSnapshot().context).toEqual({
      windows,
      currentIndex: 1,
      triggerModifier: "SUPER",
    });
    actor.stop();
  });

  test("does not activate without multiple candidates", () => {
    const actor = createTestActor();

    actor.send({
      type: "ACTIVATE",
      windows: windows.slice(0, 1),
      index: 0,
      triggerModifier: "ALT",
    });

    expect(actor.getSnapshot().matches("hidden")).toBe(true);
    actor.stop();
  });

  test("cycles the active selection while preserving session inputs", () => {
    const actor = createTestActor();
    actor.send({ type: "ACTIVATE", windows, index: 2, triggerModifier: "SUPER" });

    actor.send({ type: "CYCLE", direction: "next" });

    expect(actor.getSnapshot().context).toEqual({
      windows,
      currentIndex: 0,
      triggerModifier: "SUPER",
    });
    actor.stop();
  });

  test("selects a clicked window before commit", () => {
    const actor = createTestActor();
    actor.send({ type: "ACTIVATE", windows, index: 0, triggerModifier: "ALT" });

    actor.send({ type: "SELECT", index: 2 });

    expect(actor.getSnapshot().context.currentIndex).toBe(2);
    actor.stop();
  });

  test("refreshes an active session and resets its selection", () => {
    const actor = createTestActor();
    actor.send({ type: "ACTIVATE", windows, index: 2, triggerModifier: "ALT" });
    const refreshedWindows = windows.slice().reverse();

    actor.send({ type: "REFRESH", windows: refreshedWindows });

    expect(actor.getSnapshot().context.windows).toEqual(refreshedWindows);
    expect(actor.getSnapshot().context.currentIndex).toBe(0);
    actor.stop();
  });

  test.each(["COMMIT", "HIDE"] as const)("returns to hidden on %s", (type) => {
    const actor = createTestActor();
    actor.send({ type: "ACTIVATE", windows, index: 1, triggerModifier: "ALT" });

    actor.send({ type });

    expect(actor.getSnapshot().matches("hidden")).toBe(true);
    actor.stop();
  });

  test("ignores session events while hidden", () => {
    const actor = createTestActor();

    actor.send({ type: "CYCLE", direction: "next" });
    actor.send({ type: "SELECT", index: 2 });
    actor.send({ type: "REFRESH", windows });

    expect(actor.getSnapshot().context).toEqual({
      windows: [],
      currentIndex: 0,
      triggerModifier: "ALT",
    });
    actor.stop();
  });
});
