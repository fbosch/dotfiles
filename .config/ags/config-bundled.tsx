#!/usr/bin/env -S ags run

import "ags/gtk4/app";
import "@/components/ai-pointer/install-host-runtime";
import {
	startComponentHost,
	type ComponentModule,
} from "@/services/component-host";
import { resetAiPointerStartupState } from "@/components/ai-pointer/startup";
import { bundledCss } from "@/styles/bundled-css";
import { configureAgsTaskbarIdentity } from "@/services/taskbar-identity";
import GLib from "gi://GLib?version=2.0";

// A unique benchmark instance keeps fresh-process measurements isolated from the live shell.
const instanceName =
	GLib.getenv("AGS_MEMORY_BENCHMARK_INSTANCE") ?? "ags-bundled";

function recordStartupBenchmarkAgsReady(): void {
	try {
		if (instanceName !== "ags-bundled") return;
		const benchmarkSession = GLib.getenv("HYPR_STARTUP_BENCHMARK_SESSION");
		if (!benchmarkSession) return;
		const configuredStateHome = GLib.getenv("XDG_STATE_HOME");
		const stateHome = configuredStateHome || `${GLib.get_home_dir()}/.local/state`;
		if (!GLib.file_test(`${stateHome}/hypr-startup-benchmark/armed`, GLib.FileTest.EXISTS)) return;

		// Match Hyprland's recorder clock so suspend time cannot skew the interval.
		const [success, contents] = GLib.file_get_contents("/proc/uptime");
		const uptime = success && contents
			? /^([0-9]+)\.([0-9]+)/.exec(new TextDecoder().decode(contents))
			: null;
		if (!uptime) throw new Error("Could not read /proc/uptime");
		const timestamp = `${uptime[1]}.${uptime[2].slice(0, 9).padEnd(9, "0")}`;
		const recorder = `${GLib.get_home_dir()}/.config/hypr/benchmarks/startup-recorder.sh`;
		GLib.spawn_command_line_async(
			`${GLib.shell_quote(recorder)} mark ${GLib.shell_quote(benchmarkSession)} ags-component-host-main-complete ${timestamp}`,
		);
	} catch (error) {
		console.error("[ags-bundled] Startup benchmark recorder failed:", error);
	}
}

declare global {
	var ConfirmDialog: ComponentModule;
	var VolumeIndicator: ComponentModule;
	var KeyboardSwitcher: ComponentModule;
	var StartMenu: ComponentModule;
	var WindowSwitcher: ComponentModule;
	var DesktopClock: ComponentModule;
	var CalendarWidget: ComponentModule;
	var AudioMixerWidget: ComponentModule;
	var PipSnapPreview: ComponentModule;
}

import "@/components/confirm-dialog/index.tsx";
import "@/components/volume-indicator/index.tsx";
import "@/components/keyboard-switcher/index.tsx";
import "@/components/start-menu/index.tsx";
import "@/components/window-switcher/index.tsx";
import "@/components/desktop-clock";
import "@/components/calendar/index.tsx";
import "@/components/audio-mixer/index.tsx";
import "@/components/pip-snap-preview.tsx";

configureAgsTaskbarIdentity();
resetAiPointerStartupState();

startComponentHost({
	instanceName,
	css: bundledCss,
	onReady: recordStartupBenchmarkAgsReady,
	components: [
		() => globalThis.ConfirmDialog,
		() => globalThis.VolumeIndicator,
		() => globalThis.KeyboardSwitcher,
		() => globalThis.StartMenu,
		() => globalThis.WindowSwitcher,
		() => globalThis.DesktopClock,
		() => globalThis.CalendarWidget,
		() => globalThis.AudioMixerWidget,
		() => globalThis.PipSnapPreview,
	],
	taskbarVisibilityComponents: [
		"start-menu",
		"calendar-widget",
		"audio-mixer-widget",
	],
});
