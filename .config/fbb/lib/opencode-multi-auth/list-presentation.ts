import { type InspectColor, styleText } from "node:util";
import { colorProfileName } from "../profile-color.ts";
import {
	emptyProgressCells,
	filledProgressCells,
	renderProgressBar,
} from "../progress-bar.ts";
import { colorUsage } from "../usage-color.ts";
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
	if (profiles.length === 0) {
		return [
			`Info     ${options.emptyMessage || "No accounts found."}`,
			options.nextAction || "  Run `ocma login <alias>` to add an account.",
		].join("\n");
	}
	const stacked = plain || narrowOutput(options.columns);
	return profiles
		.map((profile) =>
			renderAccountCard(profile, color, colorEnabled, stacked, plain),
		)
		.join("\n\n");
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
		`  primary    ${formatUsageWindow(profile.usage?.primary ?? null, color, colorEnabled)}`,
		`  secondary  ${formatUsageWindow(profile.usage?.secondary ?? null, color, colorEnabled)}`,
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
		formatUsageDetail(
			"Primary",
			profile.usage?.primary ?? null,
			color,
			colorEnabled,
			plain,
		),
		formatUsageDetail(
			"Secondary",
			profile.usage?.secondary ?? null,
			color,
			colorEnabled,
			plain,
		),
	].join("\n");
}

function formatUsageDetail(
	label: string,
	window: AccountUsage["primary"] | null,
	color: Colorize,
	colorEnabled: boolean,
	plain: boolean,
): string {
	if (window === null || window.remainingPercent === null) {
		return `  ${label}\n    ${color("gray", "unavailable")}`;
	}
	const usage = plain
		? `${window.remainingPercent}% remaining`
		: `${renderUsageBar(window.remainingPercent, color, colorEnabled)} ${colorUsage(`${window.remainingPercent}% remaining`, window.remainingPercent, colorEnabled)}`;
	return `  ${label}\n    ${usage}\n    ${color("gray", `resets ${formatReset(window.resetAt)}`)}`;
}

function formatUsageWindow(
	window: AccountUsage["primary"] | null,
	color: Colorize,
	colorEnabled: boolean,
): string {
	if (window === null || window.remainingPercent === null) {
		return color("gray", "unavailable");
	}
	const bar = renderUsageBar(window.remainingPercent, color, colorEnabled);
	return `${bar} ${colorUsage(`${window.remainingPercent}% remaining`, window.remainingPercent, colorEnabled)}  ${color("gray", `resets ${formatReset(window.resetAt)}`)}`;
}

function narrowOutput(columns: number | undefined): boolean {
	if (columns === undefined) {
		return false;
	}
	return Math.max(20, Math.min(500, columns)) < 48;
}

function renderUsageBar(
	remainingPercent: number,
	color: Colorize,
	colorEnabled: boolean,
): string {
	const { fullCells, partialCell, emptyCells } =
		renderProgressBar(remainingPercent);
	return `${colorUsage(filledProgressCells(fullCells), remainingPercent, colorEnabled)}${colorUsage(partialCell, remainingPercent, colorEnabled)}${color("gray", emptyProgressCells(emptyCells))}`;
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
