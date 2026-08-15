import { describe, expect, test } from "bun:test";
import {
	aboutThisPCDetails,
	formatFrequency,
	formatUptime,
	namedField,
	parseGraphics,
	parseKeyValueText,
	parseMemoryClock,
	usableValue,
} from "../model";

describe("About This PC model", () => {
	test("filters firmware placeholders and parses key-value files", () => {
		expect(usableValue("System Product Name")).toBeUndefined();
		expect(usableValue("  Framework Laptop  ")).toBe("Framework Laptop");
		expect(
			parseKeyValueText('NAME="NixOS"\nVERSION_ID=26.11\nINVALID').get("NAME"),
		).toBe("NixOS");
	});

	test("reads named fields and formats clocks", () => {
		expect(namedField("model name: Example CPU\ncpu MHz: 800", "model name")).toBe(
			"Example CPU",
		);
		expect(formatFrequency(4_200)).toBe("4.2 GHz");
		expect(formatFrequency(800)).toBe("800 MHz");
		expect(formatFrequency(Number.NaN)).toBeUndefined();
	});

	test("formats uptime without empty units", () => {
		expect(formatUptime(30)).toBe("Less than a minute");
		expect(formatUptime(3_660)).toBe("1 hour, 1 minute");
		expect(formatUptime(90_000)).toBe("1 day, 1 hour");
	});

	test("parses graphics and configured memory speeds", () => {
		expect(
			parseGraphics(
				'00:02.0 "VGA compatible controller" "Intel Corporation" "Arc Graphics [Arc 140V]"',
			),
		).toBe("Intel Arc 140V");
		expect(
			parseMemoryClock(
				"Configured Memory Speed: 5600 MT/s\nConfigured Memory Speed: 6000 MT/s",
			),
		).toBe("6000 MT/s");
	});

	test("builds only available detail rows and preserves NixOS generation", () => {
		const details = aboutThisPCDetails({
			deviceName: "Example",
			deviceIcon: "icon",
			processor: "CPU",
			processorClock: "4 GHz",
			operatingSystem: "NixOS 26.11",
			operatingSystemCodename: "Xantusia",
			nixosGeneration: "123",
		});
		expect(details).toEqual([
			{ label: "CPU", value: "CPU (4 GHz)" },
			{ label: "OS", value: "NixOS 26.11 Xantusia (123)", icon: undefined },
		]);
	});
});
