#!/usr/bin/env -S ags run

import "ags/gtk4/app";
import {
	startComponentHost,
	type ComponentModule,
} from "@/services/component-host";
import { bundledCss } from "@/styles/stylesheets";
import GLib from "gi://GLib?version=2.0";

// A unique benchmark instance keeps fresh-process measurements isolated from the live shell.
const instanceName =
	GLib.getenv("AGS_MEMORY_BENCHMARK_INSTANCE") ?? "ags-bundled";

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
	var AiPointer: ComponentModule;
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
import "@/components/ai-pointer/index.tsx";

startComponentHost({
	instanceName,
	css: bundledCss,
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
		() => globalThis.AiPointer,
	],
	taskbarVisibilityComponents: [
		"start-menu",
		"calendar-widget",
		"audio-mixer-widget",
	],
});
