import { type InspectColor, styleText } from "node:util";
import { colorProfileName } from "../profile-color.ts";
import {
	emptyProgressCells,
	filledProgressCells,
	renderProgressBar,
} from "../progress-bar.ts";
import { usageColor } from "../usage-color.ts";
import { escapeTerminalText } from "./terminal-text.ts";
import type { AccountUsage, PublicAccountListProfile } from "./types.ts";

type Colorize = (
	format: InspectColor | readonly InspectColor[],
	value: string,
) => string;

export type AccountCardOptions = {
	colorEnabled: boolean;
	plain: boolean;
	columns?: number;
	heading?: string;
	emptyMessage?: string;
	nextAction?: string;
};

export type DisplayAccountListProfile = PublicAccountListProfile & {
	displayColor: number | null;
};

export function renderAccountCards(
	profiles: DisplayAccountListProfile[],
	options: AccountCardOptions = {
		colorEnabled: process.stdout.isTTY === true,
		plain: false,
	},
): string {
	const { colorEnabled, plain } = options;
	const color: Colorize = colorEnabled
		? styleText
		: (_: InspectColor | readonly InspectColor[], value: string) => value;
	const heading = color(
		["bold", "cyan"],
		options.heading || `OpenAI accounts (${profiles.length})`,
	);
	if (profiles.length === 0) {
		return [
			heading,
			`Info     ${options.emptyMessage || "No accounts found."}`,
			options.nextAction || "  Run `ocma login <alias>` to add an account.",
		].join("\n");
	}
	const stacked = plain || narrowOutput(options.columns);
	return [
		heading,
		...profiles.map((profile) =>
			renderAccountCard(profile, color, colorEnabled, stacked, plain),
		),
	].join("\n\n");
}

function renderAccountCard(
	profile: DisplayAccountListProfile,
	color: Colorize,
	colorEnabled: boolean,
	stacked: boolean,
	plain: boolean,
): string {
	const name = escapeTerminalText(
		profile.alias || profile.generatedLabel || "unresolved",
	);
	if (stacked) {
		return renderStackedAccountCard(profile, name, color, colorEnabled, plain);
	}
	return renderCompactAccountCard(profile, name, color, colorEnabled);
}

function renderCompactAccountCard(
	profile: DisplayAccountListProfile,
	name: string,
	color: Colorize,
	colorEnabled: boolean,
): string {
	const state = profile.active ? "active" : "inactive";
	const marker = profile.active ? "*" : "-";
	return [
		`${color(profile.active ? "green" : "gray", marker)} ${colorProfileName(name, profile.displayColor, colorEnabled)} ${color(profile.active ? "green" : "gray", state)}`,
		`  primary    ${formatUsageWindow(profile.usage?.primary ?? null, color)}`,
		`  secondary  ${formatUsageWindow(profile.usage?.secondary ?? null, color)}`,
	].join("\n");
}

function renderStackedAccountCard(
	profile: DisplayAccountListProfile,
	name: string,
	color: Colorize,
	colorEnabled: boolean,
	plain: boolean,
): string {
	return [
		`${colorProfileName(name, profile.displayColor, colorEnabled)} ${profile.active ? "active" : "inactive"}`,
		formatUsageDetail("Primary", profile.usage?.primary ?? null, color, plain),
		formatUsageDetail(
			"Secondary",
			profile.usage?.secondary ?? null,
			color,
			plain,
		),
	].join("\n");
}

function formatUsageDetail(
	label: string,
	window: AccountUsage["primary"] | null,
	color: Colorize,
	plain: boolean,
): string {
	if (window === null || window.remainingPercent === null) {
		return `  ${label}\n    ${color("gray", "unavailable")}`;
	}
	const style = usageColor(window.remainingPercent);
	const usage = plain
		? `${window.remainingPercent}% remaining`
		: `${renderUsageBar(window.remainingPercent, style, color)} ${color(style, `${window.remainingPercent}% remaining`)}`;
	return `  ${label}\n    ${usage}\n    ${color("gray", `resets ${formatReset(window.resetAt)}`)}`;
}

function formatUsageWindow(
	window: AccountUsage["primary"] | null,
	color: Colorize,
): string {
	if (window === null || window.remainingPercent === null) {
		return color("gray", "unavailable");
	}
	const style = usageColor(window.remainingPercent);
	const bar = renderUsageBar(window.remainingPercent, style, color);
	return `${bar} ${color(style, `${window.remainingPercent}% remaining`)}  ${color("gray", `resets ${formatReset(window.resetAt)}`)}`;
}

function narrowOutput(columns: number | undefined): boolean {
	if (columns === undefined) {
		return false;
	}
	return Math.max(20, Math.min(500, columns)) < 48;
}

function renderUsageBar(
	remainingPercent: number,
	style: InspectColor,
	color: Colorize,
): string {
	const { fullCells, partialCell, emptyCells } =
		renderProgressBar(remainingPercent);
	return `${color(style, filledProgressCells(fullCells))}${color(style, partialCell)}${color("gray", emptyProgressCells(emptyCells))}`;
}

function formatReset(resetAt: string | null): string {
	if (resetAt === null) {
		return "--";
	}
	const milliseconds = Date.parse(resetAt) - Date.now();
	if (Number.isNaN(milliseconds) || milliseconds <= 0) {
		return milliseconds <= 0 ? "now" : "--";
	}
	const seconds = Math.ceil(milliseconds / 1000);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	if (seconds < 3_600) {
		return `${Math.ceil(seconds / 60)}m`;
	}
	if (seconds < 86_400) {
		return `${Math.ceil(seconds / 3_600)}h`;
	}
	return `${Math.ceil(seconds / 86_400)}d`;
}
