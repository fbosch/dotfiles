import { describe, expect, test } from "bun:test";
import { chooseProgramsForSelection, type ProgramWindow } from "../program-policy";

const selection = { x: 100, y: 100, width: 400, height: 200 };

function program(
	address: string,
	geometry: { x: number; y: number; width: number; height: number },
	focusHistoryId: number,
): ProgramWindow {
	return { address, class: address, focusHistoryId, geometry, pid: focusHistoryId + 1 };
}

describe("program matching", () => {
	test("returns distinct programs spanned by the selection", () => {
		const result = chooseProgramsForSelection(selection, [
			program("left", { x: 100, y: 100, width: 180, height: 200 }, 1),
			program("right", { x: 320, y: 100, width: 180, height: 200 }, 2),
		], "left");

		expect(result.map(({ class: appClass }) => appClass)).toEqual(["left", "right"]);
		expect(result.map(({ coverage }) => coverage)).toEqual([0.45, 0.45]);
	});

	test("suppresses a fully covered lower window", () => {
		const result = chooseProgramsForSelection(selection, [
			program("front", { x: 50, y: 50, width: 500, height: 300 }, 0),
			program("behind", { x: 100, y: 100, width: 400, height: 200 }, 1),
		], "front");

		expect(result.map(({ class: appClass }) => appClass)).toEqual(["front"]);
	});

	test("ignores incidental edge overlap", () => {
		const result = chooseProgramsForSelection(selection, [
			program("main", { x: 100, y: 100, width: 400, height: 200 }, 0),
			program("edge", { x: 495, y: 100, width: 100, height: 200 }, 1),
		], "main");

		expect(result.map(({ class: appClass }) => appClass)).toEqual(["main"]);
	});
});
