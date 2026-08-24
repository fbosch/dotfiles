import { describe, expect, test } from "bun:test";
import { createActor } from "xstate";
import { aiPointerMachine } from "../machine";

describe("aiPointerMachine", () => {
	test("moves through selection, composition, request, and answer", () => {
		const actor = createActor(aiPointerMachine).start();
		actor.send({ type: "START" });
		expect(actor.getSnapshot().matches("selecting")).toBe(true);
		expect(actor.getSnapshot().hasTag("selector-active")).toBe(true);
		actor.send({ type: "FINISH" });
		expect(actor.getSnapshot().matches("preparing")).toBe(true);
		expect(actor.getSnapshot().hasTag("surface-visible")).toBe(true);
		actor.send({ type: "CAPTURED" });
		expect(actor.getSnapshot().matches("composition")).toBe(true);
		actor.send({ type: "SUBMIT" });
		expect(actor.getSnapshot().matches("requesting")).toBe(true);
		actor.send({ type: "ANSWERED" });
		expect(actor.getSnapshot().matches("answered")).toBe(true);
		actor.send({ type: "CANCEL" });
		expect(actor.getSnapshot().matches("idle")).toBe(true);
		actor.stop();
	});

	test("supports cancellation and failure from every active phase", () => {
		for (const events of [
			[{ type: "START" }],
			[{ type: "START" }, { type: "FINISH" }],
			[{ type: "START" }, { type: "FINISH" }, { type: "CAPTURED" }],
			[{ type: "START" }, { type: "FINISH" }, { type: "CAPTURED" }, { type: "SUBMIT" }],
			[{ type: "START" }, { type: "FINISH" }, { type: "CAPTURED" }, { type: "SUBMIT" }, { type: "ANSWERED" }],
		] as const) {
			const actor = createActor(aiPointerMachine).start();
			for (const event of events) actor.send(event);
			actor.send({ type: "CANCEL" });
			expect(actor.getSnapshot().matches("idle")).toBe(true);
			actor.stop();
		}

		for (const events of [
			[{ type: "START" }],
			[{ type: "START" }, { type: "FINISH" }],
			[{ type: "START" }, { type: "FINISH" }, { type: "CAPTURED" }],
			[{ type: "START" }, { type: "FINISH" }, { type: "CAPTURED" }, { type: "SUBMIT" }],
		] as const) {
			const actor = createActor(aiPointerMachine).start();
			for (const event of events) actor.send(event);
			actor.send({ type: "FAIL" });
			expect(actor.getSnapshot().matches("failed")).toBe(true);
			actor.send({ type: "CANCEL" });
			expect(actor.getSnapshot().matches("idle")).toBe(true);
			actor.stop();
		}
	});

	test("ignores duplicate starts while active", () => {
		const actor = createActor(aiPointerMachine).start();
		actor.send({ type: "START" });
		actor.send({ type: "START" });
		expect(actor.getSnapshot().matches("selecting")).toBe(true);
		actor.stop();
	});
});
