import { describe, expect, test } from "bun:test";
import { chooseAccessibilityWindow } from "../accessibility-window-policy";

describe("accessibility window matching", () => {
	test("keeps a unique exact-PID window when AT-SPI focus is stale", () => {
		expect(
			chooseAccessibilityWindow([
				{ active: false, exactPid: true, value: "browser" },
			]),
		).toBe("browser");
	});

	test("keeps a unique title match when a sandbox hides the exact PID", () => {
		expect(
			chooseAccessibilityWindow([
				{ active: false, exactPid: false, titleMatch: true, value: "sandboxed browser" },
			]),
		).toBe("sandboxed browser");
	});

	test("rejects an inactive PID-less match without title identity", () => {
		expect(
			chooseAccessibilityWindow([
				{ active: false, exactPid: false, value: "unrelated window" },
			]),
		).toBeNull();
	});

	test("uses accessibility focus only to disambiguate matching windows", () => {
		expect(
			chooseAccessibilityWindow([
				{ active: false, exactPid: false, value: "other" },
				{ active: true, exactPid: false, value: "browser" },
			]),
		).toBe("browser");
	});

	test("uses title to disambiguate stale same-process windows", () => {
		expect(
			chooseAccessibilityWindow([
				{ active: false, exactPid: true, titleMatch: false, value: "other tab" },
				{ active: false, exactPid: true, titleMatch: true, value: "active tab" },
			]),
		).toBe("active tab");
	});

	test("rejects ambiguous stale matches", () => {
		expect(
			chooseAccessibilityWindow([
				{ active: false, exactPid: false, value: "first" },
				{ active: false, exactPid: false, value: "second" },
			]),
		).toBeNull();
	});
});
