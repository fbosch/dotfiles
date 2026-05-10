import {
	Action,
	ActionPanel,
	closeMainWindow,
	Color,
	Icon,
	List,
	showToast,
	Toast,
} from "@vicinae/api";
import { useCallback, useEffect, useState } from "react";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	HyprMonitorInfo,
	HyprpropWindowInfo,
	WindowRuleProfile,
	RuleSelector,
} from "./types";

const execAsync = promisify(exec);

type LuaValue = string | number | boolean | [number, number];

type LuaRuleEntry = {
	id: string;
	match: Record<string, string>;
	effects: Record<string, LuaValue>;
	source: "quickrule" | "window-state";
	comment: string;
};

type WindowStateSnapshot = {
	monitor: string;
	size: [number, number];
	move: [number, number];
};

const QUICKRULE_LUA_HEADER = `-- Auto-generated Lua window rules by hypr-quickrule
-- Do not edit manually

`;

const WINDOW_STATE_SELECTORS_LUA_HEADER = `-- Window state persistence selectors.
-- Source selector list read by runtime/windows/window-state.sh.

`;

const WINDOW_STATE_RULES_LUA_HEADER = `-- Auto-generated Lua window state persistence rules
-- Managed by hypr-quickrule and runtime/windows/window-state.sh

`;

const BOOLEAN_RULE_EFFECTS: Record<string, string> = {
	"float on": "float",
	"pin on": "pin",
	"no_anim on": "no_anim",
	"fullscreen on": "fullscreen",
	"center on": "center",
	"no_shadow on": "no_shadow",
};

const BOOLEAN_FALSE_RULE_EFFECTS: Record<string, string> = {
	"decorate off": "decorate",
};

const RULE_SELECTORS: RuleSelector[] = [
	"class",
	"initial_class",
	"title",
	"initial_title",
];

// Common window rule profiles based on existing Hyprland rules.
const RULE_PROFILES: WindowRuleProfile[] = [
	{
		id: "floating-small",
		name: "Floating (Small)",
		description: "Float window with small size (360x620)",
		icon: Icon.AppWindowSidebarRight,
		rules: ["float on", "size 360 620"],
	},
	{
		id: "floating-medium",
		name: "Floating (Medium)",
		description: "Float window with medium size (750x900)",
		icon: Icon.AppWindowSidebarRight,
		rules: ["float on", "size 750 900"],
	},
	{
		id: "floating-large",
		name: "Floating (Large)",
		description: "Float window with large size (900x900)",
		icon: Icon.AppWindowSidebarRight,
		rules: ["float on", "size 900 900"],
	},
	{
		id: "floating-centered",
		name: "Floating (Centered)",
		description: "Float window and center it",
		icon: Icon.Center,
		rules: ["float on", "center on"],
	},
	{
		id: "floating-pinned",
		name: "Floating + Pinned",
		description: "Float and pin to all workspaces",
		icon: Icon.Pin,
		rules: ["float on", "pin on"],
	},
	{
		id: "floating-pinned-corner",
		name: "Floating + Pinned (Corner)",
		description: "Float, pin, and position in bottom-right corner",
		icon: Icon.Pin,
		rules: ["float on", "pin on", "move onscreen 100% 100%"],
	},
	{
		id: "fullscreen",
		name: "Fullscreen",
		description: "Force fullscreen mode",
		icon: Icon.Maximize,
		rules: ["fullscreen on"],
	},
	{
		id: "no-animations",
		name: "No Animations",
		description: "Disable animations (useful for games)",
		icon: Icon.XMarkCircle,
		rules: ["no_anim on"],
	},
	{
		id: "no-bar",
		name: "No Decorations",
		description: "Disable Hyprland window decorations",
		icon: Icon.Minus,
		rules: ["decorate off"],
	},
	{
		id: "no-bar-float",
		name: "No Decorations + Float",
		description: "Disable decorations and float window",
		icon: Icon.AppWindowSidebarRight,
		rules: ["decorate off", "float on"],
	},
	{
		id: "gaming",
		name: "Gaming Profile",
		description:
			"No animations, no decorations, no borders, fullscreen (like Steam games)",
		icon: Icon.GameController,
		rules: [
			"no_anim on",
			"decorate off",
			"border_size 0",
			"rounding 0",
			"no_shadow on",
			"opacity 1.0 override 1.0 override",
			"fullscreen on",
		],
	},
	{
		id: "utility",
		name: "Utility Window",
		description:
			"Float, pin, no animations, positioned at corner (like system tools)",
		icon: Icon.Hammer,
		rules: ["float on", "pin on", "no_anim on", "move onscreen 100% 100%"],
	},
	{
		id: "clean-fullscreen",
		name: "Clean Fullscreen",
		description: "Fullscreen with no decorations (like remote desktop)",
		icon: Icon.Monitor,
		rules: ["decorate off", "fullscreen on"],
	},
	{
		id: "picture-in-picture",
		name: "Picture-in-Picture",
		description: "Float, pin, with slide animation (like browser PiP)",
		icon: Icon.Video,
		rules: ["float on", "pin on", "decorate off", "animation slide right"],
	},
	{
		id: "dialog",
		name: "Dialog Window",
		description:
			"Float, pin, no animations, no decorations (like system dialogs)",
		icon: Icon.Message,
		rules: ["float on", "pin on", "no_anim on", "decorate off"],
	},
	{
		id: "file-manager",
		name: "File Manager",
		description: "Float with no animations (like Nemo)",
		icon: Icon.Finder,
		rules: ["float on", "no_anim on"],
	},
	{
		id: "borderless",
		name: "Borderless Window",
		description: "Remove borders and rounding",
		icon: Icon.Minus,
		rules: ["border_size 0", "rounding 0"],
	},
	{
		id: "no-shadow",
		name: "No Shadow",
		description: "Disable window shadow",
		icon: Icon.Moon,
		rules: ["no_shadow on"],
	},
	{
		id: "force-opaque",
		name: "Force Opaque",
		description: "Override opacity to 100% (disable transparency)",
		icon: Icon.Eye,
		rules: ["opacity 1.0 override 1.0 override"],
	},
	{
		id: "save-state",
		name: "Save Window State",
		description:
			"Remember window size and position (saves to window-state-selectors.lua)",
		icon: Icon.SaveDocument,
		rules: [], // Special profile - doesn't write rules
	},
	{
		id: "snapshot-state",
		name: "Snapshot Window State",
		description: "Save the selected window's current size and position now",
		icon: Icon.SaveDocument,
		rules: [], // Special profile - writes current geometry immediately
	},
];

export default function Command() {
	const [windowInfo, setWindowInfo] = useState<HyprpropWindowInfo | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [selectedProfile, setSelectedProfile] =
		useState<WindowRuleProfile | null>(null);
	const [selector, setSelector] = useState<RuleSelector>("class");

	const fetchWindowInfo =
		useCallback(async (): Promise<HyprpropWindowInfo | null> => {
			try {
				// Check if hyprprop is available
				try {
					await execAsync("which hyprprop");
				} catch {
					await showToast({
						style: Toast.Style.Failure,
						title: "hyprprop not found",
						message: "Please install hyprprop to use this extension",
					});
					return null;
				}

				// Run hyprprop with --raw flag to get JSON output
				const { stdout, stderr } = await execAsync("hyprprop --raw");

				if (stderr) {
					console.error("hyprprop stderr:", stderr);
				}

				if (!stdout || stdout.trim() === "") {
					await showToast({
						style: Toast.Style.Failure,
						title: "No window selected",
						message: "Please select a window",
					});
					return null;
				}

				const data: HyprpropWindowInfo = JSON.parse(stdout);
				return data;
			} catch (error) {
				await showToast({
					style: Toast.Style.Failure,
					title: "Failed to get window info",
					message: error instanceof Error ? error.message : "Unknown error",
				});
				return null;
			}
		}, []);

	const loadWindowInfo = useCallback(async () => {
		setIsLoading(true);
		const info = await fetchWindowInfo();
		setWindowInfo(info);
		setIsLoading(false);
	}, [fetchWindowInfo]);

	useEffect(() => {
		loadWindowInfo();
	}, [loadWindowInfo]);

	const getRuleSelectorValue = (
		info: HyprpropWindowInfo,
		sel: RuleSelector,
	): string => {
		switch (sel) {
			case "class":
				return info.class;
			case "initial_class":
				return info.initialClass;
			case "title":
				return info.title;
			case "initial_title":
				return info.initialTitle;
		}
	};

	const escapeRegex = (str: string): string => {
		return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	};

	const parseLuaRuleEffect = (rule: string): [string, LuaValue] => {
		const booleanEffect = BOOLEAN_RULE_EFFECTS[rule];
		if (booleanEffect) {
			return [booleanEffect, true];
		}

		const booleanFalseEffect = BOOLEAN_FALSE_RULE_EFFECTS[rule];
		if (booleanFalseEffect) {
			return [booleanFalseEffect, false];
		}

		const [effect, ...args] = rule.split(" ");
		const value = args.join(" ");

		if (effect === "size" && args.length === 2) {
			const width = Number(args[0]);
			const height = Number(args[1]);
			if (Number.isFinite(width) && Number.isFinite(height)) {
				return [effect, [width, height]];
			}
		}

		if (effect === "border_size" || effect === "rounding") {
			const numberValue = Number(value);
			if (Number.isFinite(numberValue)) {
				return [effect, numberValue];
			}
		}

		return [effect, value];
	};

	const luaString = (value: string): string => JSON.stringify(value);
	const luaLongString = (value: string): string => `[=[${value}]=]`;

	const luaKey = (key: string): string => {
		return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `[${luaString(key)}]`;
	};

	const luaValue = (value: LuaValue): string => {
		if (typeof value === "string") {
			return luaString(value);
		}

		if (typeof value === "number") {
			return String(value);
		}

		if (typeof value === "boolean") {
			return value ? "true" : "false";
		}

		return `{ ${value[0]}, ${value[1]} }`;
	};

	const serializeLuaMap = (
		values: Record<string, LuaValue | string>,
		indent: string,
	): string => {
		return Object.entries(values)
			.map(([key, value]) => `${indent}${luaKey(key)} = ${luaValue(value)},`)
			.join("\n");
	};

	const serializeLuaRuleEntry = (entry: LuaRuleEntry): string => {
		return [
			`  -- BEGIN ${entry.id}`,
			serializeLuaTableRuleEntry(entry),
			`  -- END ${entry.id}`,
		].join("\n");
	};

	const serializeLuaTableRuleEntry = (entry: LuaRuleEntry): string => {
		return [
			"  {",
			`    id = ${luaString(entry.id)},`,
			"    match = {",
			serializeLuaMap(entry.match, "      "),
			"    },",
			"    effects = {",
			serializeLuaMap(entry.effects, "      "),
			"    },",
			`    source = ${luaString(entry.source)},`,
			`    comment = ${luaString(entry.comment)},`,
			"  },",
		].join("\n");
	};

	const readLuaRuleBlocks = (content: string): Map<string, string> => {
		const blocks = new Map<string, string>();
		const blockPattern =
			/^[\t ]+-- BEGIN ([^\n]+)\n([\s\S]*?)\n[\t ]+-- END \1$/gm;

		for (const match of content.matchAll(blockPattern)) {
			blocks.set(match[1], match[0]);
		}

		return blocks;
	};

	const renderLuaRuleFile = (blocks: Map<string, string>): string => {
		const entries = [...blocks.values()];
		return `${QUICKRULE_LUA_HEADER}return {\n${entries.length > 0 ? `${entries.join("\n\n")}\n` : ""}}\n`;
	};

	const renderWindowStateSelectorFile = (entry: string): string => {
		return `${WINDOW_STATE_SELECTORS_LUA_HEADER}return {\n${entry}\n}\n`;
	};

	const renderWindowStateRuleFile = (entry: string): string => {
		return `${WINDOW_STATE_RULES_LUA_HEADER}return {\n${entry}\n}\n`;
	};

	const serializeWindowStateSelectorEntry = (
		matcher: string,
		pattern: string,
	): string => {
		return `  { matcher = ${luaString(matcher)}, pattern = ${luaLongString(pattern)} },`;
	};

	const hasWindowStateSelector = (
		content: string,
		matcher: string,
		pattern: string,
	): boolean => {
		const matcherValue = escapeRegex(luaString(matcher));
		const patternValue = escapeRegex(luaLongString(pattern));
		return new RegExp(
			`matcher\\s*=\\s*${matcherValue}\\s*,\\s*pattern\\s*=\\s*${patternValue}`,
		).test(content);
	};

	const isRuleSelector = (value: string): value is RuleSelector => {
		return RULE_SELECTORS.some((selectorValue) => selectorValue === value);
	};

	const setRuleSelector = (value: string) => {
		if (isRuleSelector(value)) {
			setSelector(value);
		}
	};

	const isStateProfile = (profile: WindowRuleProfile): boolean => {
		return profile.id === "save-state" || profile.id === "snapshot-state";
	};

	const appendWindowStateSelector = (
		content: string,
		entry: string,
	): string => {
		const trimmed = content.trimEnd();
		if (/}\s*$/.test(trimmed)) {
			return `${trimmed.replace(/}\s*$/, entry)}\n}\n`;
		}

		return renderWindowStateSelectorFile(entry);
	};

	const upsertLuaTableRuleEntry = (
		content: string,
		entry: LuaRuleEntry,
	): string => {
		const serializedEntry = serializeLuaTableRuleEntry(entry);
		const lines = content.trimEnd().split("\n");
		const idLine = `id = ${luaString(entry.id)},`;
		const idIndex = lines.findIndex((line) => line.includes(idLine));

		if (idIndex !== -1) {
			let startIndex = idIndex;
			while (startIndex > 0 && !/^  \{$/.test(lines[startIndex])) {
				startIndex -= 1;
			}

			let endIndex = idIndex;
			while (endIndex < lines.length - 1 && !/^  },$/.test(lines[endIndex])) {
				endIndex += 1;
			}

			lines.splice(
				startIndex,
				endIndex - startIndex + 1,
				...serializedEntry.split("\n"),
			);
			return `${lines.join("\n")}\n`;
		}

		if (/return\s*{\s*}\s*$/.test(content.trimEnd())) {
			return renderWindowStateRuleFile(serializedEntry);
		}

		if (/}\s*$/.test(content.trimEnd())) {
			return `${content.trimEnd().replace(/}\s*$/, serializedEntry)}\n}\n`;
		}

		return renderWindowStateRuleFile(serializedEntry);
	};

	const renderRuntimeWindowStateRulesFile = (entry: string): string => {
		return `# Auto-generated window state persistence rules\n# Selectors: $HOME/.config/hypr/rules/window-state-selectors.lua\n# Managed by hypr-quickrule and runtime/windows/window-state.sh\n\n${entry}\n`;
	};

	const renderRuntimeWindowStateRuleEntry = (
		matcher: string,
		pattern: string,
		snapshot: WindowStateSnapshot,
	): string => {
		return [
			`# ${matcher} ${pattern}`,
			`windowrule = ${matcher} (${pattern}), monitor ${snapshot.monitor}`,
			`windowrule = size ${snapshot.size[0]} ${snapshot.size[1]}, ${matcher} (${pattern})`,
			`windowrule = move ${snapshot.move[0]} ${snapshot.move[1]}, ${matcher} (${pattern})`,
		].join("\n");
	};

	const upsertRuntimeWindowStateRuleEntry = (
		content: string,
		matcher: string,
		pattern: string,
		entry: string,
	): string => {
		const lines = content.trimEnd().split("\n");
		const marker = `# ${matcher} ${pattern}`;
		const markerIndex = lines.findIndex((line) => line === marker);

		if (markerIndex === -1) {
			return `${content.trimEnd()}\n\n${entry}\n`;
		}

		let endIndex = markerIndex + 1;
		while (endIndex < lines.length && lines[endIndex].trim() !== "") {
			endIndex += 1;
		}

		lines.splice(markerIndex, endIndex - markerIndex, ...entry.split("\n"));
		return `${lines.join("\n")}\n`;
	};

	const generateLuaRuleEntry = (
		profile: WindowRuleProfile,
		info: HyprpropWindowInfo,
		sel: RuleSelector,
	): LuaRuleEntry => {
		const matchValue = escapeRegex(getRuleSelectorValue(info, sel));
		const match: Record<string, string> = {
			[sel]: `^(${matchValue})$`,
		};
		const effects: Record<string, LuaValue> = {};

		for (const rule of profile.rules) {
			const [effect, value] = parseLuaRuleEffect(rule);
			effects[effect] = value;
		}

		return {
			id: `quickrule:${sel}:${matchValue}:${profile.id}`,
			match,
			effects,
			source: "quickrule",
			comment: `Generated by hypr-quickrule for ${info.class}`,
		};
	};

	const matcherForSelector = (sel: RuleSelector): string => {
		return `match:${sel}`;
	};

	const patternForSelector = (
		info: HyprpropWindowInfo,
		sel: RuleSelector,
	): string => {
		return `^${escapeRegex(getRuleSelectorValue(info, sel))}$`;
	};

	const fetchMonitors = async (): Promise<HyprMonitorInfo[]> => {
		const { stdout } = await execAsync("hyprctl monitors -j");
		return JSON.parse(stdout);
	};

	const getSnapshot = async (
		info: HyprpropWindowInfo,
	): Promise<WindowStateSnapshot> => {
		const monitors = await fetchMonitors();
		const monitor = monitors.find((candidate) => candidate.id === info.monitor);
		const monitorX = monitor?.x ?? 0;
		const monitorY = monitor?.y ?? 0;

		return {
			monitor: monitor?.name ?? String(info.monitor),
			size: info.size,
			move: [info.at[0] - monitorX, info.at[1] - monitorY],
		};
	};

	const generateWindowStateRuleEntry = (
		info: HyprpropWindowInfo,
		sel: RuleSelector,
		snapshot: WindowStateSnapshot,
	): LuaRuleEntry => {
		const matcher = matcherForSelector(sel);
		const pattern = patternForSelector(info, sel);

		return {
			id: `window-state:${matcher}:${pattern}`,
			match: {
				[sel]: pattern,
			},
			effects: {
				monitor: snapshot.monitor,
				size: snapshot.size,
				move: snapshot.move,
			},
			source: "window-state",
			comment: `${matcher} ${pattern}`,
		};
	};

	const writeLuaRuleEntry = async (entry: LuaRuleEntry) => {
		const luaRulesDir = join(homedir(), ".config/hypr/rules");
		const luaRulesPath = join(luaRulesDir, "generated.lua");

		await fs.mkdir(luaRulesDir, { recursive: true });

		let existingRules = "";
		try {
			existingRules = await fs.readFile(luaRulesPath, "utf-8");
		} catch {
			existingRules = `${QUICKRULE_LUA_HEADER}return {}\n`;
		}

		const blocks = readLuaRuleBlocks(existingRules);
		blocks.set(entry.id, serializeLuaRuleEntry(entry));

		await fs.writeFile(luaRulesPath, renderLuaRuleFile(blocks), "utf-8");
	};

	const writeWindowStateLuaRuleEntry = async (entry: LuaRuleEntry) => {
		const luaRulesDir = join(homedir(), ".config/hypr/rules");
		const luaRulesPath = join(luaRulesDir, "window-state.lua");

		await fs.mkdir(luaRulesDir, { recursive: true });

		let existingRules = "";
		try {
			existingRules = await fs.readFile(luaRulesPath, "utf-8");
		} catch {
			existingRules = `${WINDOW_STATE_RULES_LUA_HEADER}return {}\n`;
		}

		await fs.writeFile(
			luaRulesPath,
			upsertLuaTableRuleEntry(existingRules, entry),
			"utf-8",
		);
	};

	const writeRuntimeWindowStateRuleEntry = async (
		matcher: string,
		pattern: string,
		snapshot: WindowStateSnapshot,
	) => {
		const runtimeDir = process.env.XDG_RUNTIME_DIR;
		if (!runtimeDir) {
			return;
		}

		const runtimeRulesPath = join(runtimeDir, "hypr-window-state-rules.conf");
		const entry = renderRuntimeWindowStateRuleEntry(matcher, pattern, snapshot);

		let existingRules = "";
		try {
			existingRules = await fs.readFile(runtimeRulesPath, "utf-8");
		} catch {
			existingRules = renderRuntimeWindowStateRulesFile(entry);
		}

		await fs.writeFile(
			runtimeRulesPath,
			upsertRuntimeWindowStateRuleEntry(existingRules, matcher, pattern, entry),
			"utf-8",
		);
	};

	const saveWindowState = async (info: HyprpropWindowInfo) => {
		try {
			const windowStateSelectorsPath = join(
				homedir(),
				".config/hypr/rules/window-state-selectors.lua",
			);
			const matcher = "match:class";
			const matchValue = `^${escapeRegex(info.class)}$`;

			let existingSelectors = "";
			try {
				existingSelectors = await fs.readFile(
					windowStateSelectorsPath,
					"utf-8",
				);
			} catch {
				// Missing or legacy-shaped content is normalized when appending below.
				existingSelectors = renderWindowStateSelectorFile("");
			}

			if (!existingSelectors.includes("return {")) {
				existingSelectors = renderWindowStateSelectorFile("");
			}

			if (hasWindowStateSelector(existingSelectors, matcher, matchValue)) {
				await execAsync("hyprctl reload config-only");

				await showToast({
					style: Toast.Style.Success,
					title: "Window State Already Saved",
					message: `${info.class} is already tracked; reloaded window-state rules`,
				});
				await closeMainWindow();
				return;
			}

			const newContent = appendWindowStateSelector(
				existingSelectors,
				serializeWindowStateSelectorEntry(matcher, matchValue),
			);
			await fs.writeFile(windowStateSelectorsPath, newContent, "utf-8");
			await execAsync("hyprctl reload config-only");

			await showToast({
				style: Toast.Style.Success,
				title: "Window State Saved",
				message: `Added ${info.class} to window-state-selectors.lua`,
			});

			await closeMainWindow();
		} catch (error) {
			await showToast({
				style: Toast.Style.Failure,
				title: "Failed to save window state",
				message: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	const snapshotWindowState = async (
		info: HyprpropWindowInfo,
		sel: RuleSelector,
	) => {
		try {
			const windowStateSelectorsPath = join(
				homedir(),
				".config/hypr/rules/window-state-selectors.lua",
			);
			const matcher = matcherForSelector(sel);
			const pattern = patternForSelector(info, sel);
			const snapshot = await getSnapshot(info);

			let existingSelectors = "";
			try {
				existingSelectors = await fs.readFile(
					windowStateSelectorsPath,
					"utf-8",
				);
			} catch {
				existingSelectors = renderWindowStateSelectorFile("");
			}

			if (!existingSelectors.includes("return {")) {
				existingSelectors = renderWindowStateSelectorFile("");
			}

			if (!hasWindowStateSelector(existingSelectors, matcher, pattern)) {
				const newSelectors = appendWindowStateSelector(
					existingSelectors,
					serializeWindowStateSelectorEntry(matcher, pattern),
				);
				await fs.writeFile(windowStateSelectorsPath, newSelectors, "utf-8");
			}

			const luaRuleEntry = generateWindowStateRuleEntry(info, sel, snapshot);
			await writeWindowStateLuaRuleEntry(luaRuleEntry);
			await writeRuntimeWindowStateRuleEntry(matcher, pattern, snapshot);
			await execAsync("hyprctl reload config-only");

			await showToast({
				style: Toast.Style.Success,
				title: "Window State Snapshotted",
				message: `${getRuleSelectorValue(info, sel)} saved at ${snapshot.size[0]}x${snapshot.size[1]}`,
			});

			await closeMainWindow();
		} catch (error) {
			await showToast({
				style: Toast.Style.Failure,
				title: "Failed to snapshot window state",
				message: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	const applyRule = async (
		profile: WindowRuleProfile,
		info: HyprpropWindowInfo,
		sel: RuleSelector,
	) => {
		// Special handling for save-state profile
		if (profile.id === "save-state") {
			await saveWindowState(info);
			return;
		}

		if (profile.id === "snapshot-state") {
			await snapshotWindowState(info, sel);
			return;
		}

		try {
			const luaRuleEntry = generateLuaRuleEntry(profile, info, sel);

			await writeLuaRuleEntry(luaRuleEntry);

			// Reload Hyprland config
			await execAsync("hyprctl reload");

			await showToast({
				style: Toast.Style.Success,
				title: "Rule Applied",
				message: `Applied "${profile.name}" to ${info.initialClass}`,
			});

			await closeMainWindow();
		} catch (error) {
			await showToast({
				style: Toast.Style.Failure,
				title: "Failed to apply rule",
				message: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	if (isLoading) {
		return (
			<List isLoading={true}>
				<List.EmptyView
					title="Select a Window"
					description="Hyprprop is waiting for you to select a window..."
					icon={Icon.AppWindow}
				/>
			</List>
		);
	}

	if (!windowInfo) {
		return (
			<List>
				<List.EmptyView
					title="No Window Selected"
					description="Failed to retrieve window information. Please try again."
					icon={Icon.XMarkCircle}
					actions={
						<ActionPanel>
							<Action
								title="Retry"
								icon={Icon.ArrowClockwise}
								onAction={loadWindowInfo}
								shortcut={{ modifiers: ["cmd"], key: "r" }}
							/>
						</ActionPanel>
					}
				/>
			</List>
		);
	}

	const getSelectorValue = (sel: RuleSelector): string => {
		switch (sel) {
			case "class":
				return windowInfo.class;
			case "initial_class":
				return windowInfo.initialClass;
			case "title":
				return windowInfo.title;
			case "initial_title":
				return windowInfo.initialTitle;
		}
	};

	return (
		<List
			navigationTitle={`Apply Rule to: ${windowInfo.class}`}
			searchBarPlaceholder="Search rule profiles..."
			searchBarAccessory={
				<List.Dropdown
					tooltip="Match By"
					value={selector}
					onChange={setRuleSelector}
				>
					<List.Dropdown.Item
						title={`Class (${windowInfo.class})`}
						value="class"
					/>
					<List.Dropdown.Item
						title={`Initial Class (${windowInfo.initialClass})`}
						value="initial_class"
					/>
					<List.Dropdown.Item
						title={`Title (${windowInfo.title})`}
						value="title"
					/>
					<List.Dropdown.Item
						title={`Initial Title (${windowInfo.initialTitle})`}
						value="initial_title"
					/>
				</List.Dropdown>
			}
		>
			<List.Section title="Window Information">
				<List.Item
					title={windowInfo.class}
					subtitle={`${windowInfo.title} • PID ${windowInfo.pid}`}
					icon={{ source: Icon.Info, tintColor: Color.Blue }}
					accessories={[
						{ text: `Workspace ${windowInfo.workspace.name}` },
						{ text: windowInfo.floating ? "Floating" : "Tiled" },
						{ text: windowInfo.xwayland ? "XWayland" : "Wayland" },
					]}
				/>
			</List.Section>
			<List.Section
				title="Rule Profiles"
				subtitle={`Applying to: ${getSelectorValue(selector)}`}
			>
				{RULE_PROFILES.map((profile) => (
					<List.Item
						key={profile.id}
						title={profile.name}
						subtitle={profile.description}
						icon={{
							source: profile.icon,
							tintColor: isStateProfile(profile) ? Color.Blue : Color.Green,
						}}
						accessories={[
							{
								text: isStateProfile(profile)
									? "Persistence"
									: `${profile.rules.length} rules`,
							},
						]}
						actions={
							<ActionPanel>
								<Action
									title={
										profile.id === "save-state"
											? "Save Window State"
											: profile.id === "snapshot-state"
												? "Snapshot Window State"
												: "Apply Rule"
									}
									icon={
										isStateProfile(profile)
											? Icon.SaveDocument
											: Icon.CheckCircle
									}
									onAction={() => applyRule(profile, windowInfo, selector)}
								/>
								{!isStateProfile(profile) && (
									<Action
										title="Preview Rules"
										icon={Icon.Eye}
										onAction={() => setSelectedProfile(profile)}
										shortcut={{ modifiers: ["cmd"], key: "p" }}
									/>
								)}
								<ActionPanel.Section>
									<Action
										title="Retry Window Selection"
										icon={Icon.ArrowClockwise}
										onAction={loadWindowInfo}
										shortcut={{ modifiers: ["cmd"], key: "r" }}
									/>
								</ActionPanel.Section>
							</ActionPanel>
						}
					/>
				))}
			</List.Section>
			{selectedProfile && !isStateProfile(selectedProfile) && (
				<List.Section title={`Preview: ${selectedProfile.name}`}>
					{selectedProfile.rules.map((rule, index) => (
						<List.Item
							key={index}
							title={rule}
							icon={{ source: Icon.Code, tintColor: Color.Orange }}
						/>
					))}
				</List.Section>
			)}
		</List>
	);
}
