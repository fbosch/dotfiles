import { describe, expect, test } from "bun:test";
import { createActor } from "xstate";
import { aiPointerMachine } from "../machine";

describe("aiPointerMachine", () => {
	test("moves from selection to preview and cancels to idle", () => {
		const actor = createActor(aiPointerMachine).start();
		actor.send({ type: "START" });
		expect(actor.getSnapshot().matches("selecting")).toBe(true);
		actor.send({ type: "CAPTURED" });
		expect(actor.getSnapshot().matches("preview")).toBe(true);
		actor.send({ type: "CANCEL" });
		expect(actor.getSnapshot().matches("idle")).toBe(true);
		actor.stop();
	});

	test("ignores duplicate starts while active", () => {
		const actor = createActor(aiPointerMachine).start();
		actor.send({ type: "START" });
		actor.send({ type: "START" });
		expect(actor.getSnapshot().matches("selecting")).toBe(true);
		actor.stop();
	});
});
