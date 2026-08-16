import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import { AudioMixerView } from "../../../components/audio-mixer/audio-mixer-view";
import { emptySnapshot, type AudioBackend } from "../../../components/audio-mixer/model";
import {
	componentStylesheets,
	type Stylesheet,
} from "../../../styles/stylesheets";
import { themeCss } from "../../../styles/theme-css";
import { assert, test } from "./harness";

test("AGS theme variables parse as GTK CSS", async () => {
	await assertStylesheetParses({ name: "theme", css: themeCss });
});

for (const stylesheet of componentStylesheets) {
	test(`${stylesheet.name} stylesheet parses as GTK CSS`, async () => {
		await assertStylesheetParses({
			name: stylesheet.name,
			css: `${themeCss}\n${stylesheet.css}`,
		}, stylesheet.name === "audio-mixer" ? mountAudioMixerProbe : undefined);
	});
}

async function assertStylesheetParses(
	{ name, css }: Stylesheet,
	mountProbe?: () => Promise<() => void>,
): Promise<void> {
	const diagnostics: string[] = [];
	const provider = new Gtk.CssProvider();
	provider.connect("parsing-error", (_provider, _section, error) => {
		diagnostics.push(error.message);
	});
	provider.load_from_string(css);
	const display = Gdk.Display.get_default();
	assert(display !== null, "GTK display is unavailable");
	Gtk.StyleContext.add_provider_for_display(
		display,
		provider,
		Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
	);
	let disposeProbe: (() => void) | undefined;
	try {
		disposeProbe = await mountProbe?.();
		await flushStyles();
		assert(
			diagnostics.length === 0,
			`${name} GTK CSS diagnostics:\n${diagnostics.join("\n")}`,
		);
	} finally {
		disposeProbe?.();
		Gtk.StyleContext.remove_provider_for_display(display, provider);
	}
}

async function mountAudioMixerProbe(): Promise<() => void> {
	const backend: AudioBackend = {
		init() {},
		setActive() {},
		refresh() {},
		stop() {},
		setVolume() {},
		toggleMute() {},
		setDefault() {},
	};
	const view = new AudioMixerView(
		{
			onHide() {},
			isVisible: () => true,
			onSetVolume: backend.setVolume,
			onToggleMute: backend.toggleMute,
			onSetDefault: backend.setDefault,
		},
		emptySnapshot("", "loading"),
	);
	try {
		view.create();
		view.setSnapshot({
			status: "ready",
			message: "",
			rows: {
				playback: [
					audioRow("stream", "playback"),
					audioRow("stream", "playback", true),
				],
				output: [
					audioRow("endpoint", "output"),
					audioRow("endpoint", "output", true),
				],
				input: [
					audioRow("endpoint", "input"),
					audioRow("endpoint", "input", true),
				],
			},
		});
		view.show();
		await flushStyles();
		view.setTab("output");
		await flushStyles();
		view.setTab("input");
		await flushStyles();
		view.setTab("playback");
		await flushStyles();
		return () => view.dispose();
	} catch (error) {
		view.dispose();
		throw error;
	}
}

function audioRow(
	kind: "stream" | "endpoint",
	tab: "playback" | "output" | "input",
	muted = false,
) {
	return {
		id: `${kind}:${tab}:${muted}`,
		name: `${tab} probe`,
		icon: "",
		kind,
		tab,
		object: {},
		volume: 50,
		muted,
		isDefault: kind === "endpoint" && muted === false,
	} as const;
}

function flushStyles(): Promise<void> {
	return new Promise((resolve) => {
		GLib.idle_add(GLib.PRIORITY_LOW, () => {
			resolve();
			return GLib.SOURCE_REMOVE;
		});
	});
}
