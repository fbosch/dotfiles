import { type InspectColor, styleText } from "node:util";
import { renderProgressBar } from "../progress-bar.ts";
import type { AccountUsage, PublicAccountListProfile } from "./types.ts";

type Colorize = (
	format: InspectColor | readonly InspectColor[],
	value: string,
) => string;

export function renderAccountCards(
	profiles: PublicAccountListProfile[],
	colorEnabled = process.stdout.isTTY === true,
): string {
	const color: Colorize = colorEnabled
		? styleText
		: (_: InspectColor | readonly InspectColor[], value: string) => value;
	const heading = color(
		["bold", "cyan"],
		`OpenAI accounts (${profiles.length})`,
	);
	return [
		heading,
		...profiles.map((profile) =>
			renderAccountCard(profile, color, colorEnabled),
		),
	].join("\n\n");
}

function renderAccountCard(
	profile: PublicAccountListProfile,
	color: Colorize,
	colorEnabled: boolean,
): string {
	const name = profile.alias || profile.generatedLabel || "unresolved";
	const state = profile.active ? "active" : "inactive";
	const marker = profile.active ? "*" : "-";
	return [
		`${color(profile.active ? "green" : "gray", marker)} ${color("bold", name)} ${color(profile.active ? "green" : "gray", state)} ${color("gray", `[${profile.key}]`)}`,
		`  primary    ${formatUsageWindow(profile.usage?.primary ?? null, color, colorEnabled)}`,
		`  secondary  ${formatUsageWindow(profile.usage?.secondary ?? null, color, colorEnabled)}`,
	].join("\n");
}

function formatUsageWindow(
	window: AccountUsage["primary"] | null,
	color: Colorize,
	colorEnabled: boolean,
): string {
	if (window === null || window.remainingPercent === null) {
		return color("gray", "unavailable");
	}
	const style = usageStyle(window.remainingPercent);
	const bar = renderUsageBar(
		window.remainingPercent,
		style,
		color,
		colorEnabled,
	);
	return `${bar} ${color(style, `${window.remainingPercent}% remaining`)}  ${color("gray", `resets ${formatReset(window.resetAt)}`)}`;
}

function renderUsageBar(
	remainingPercent: number,
	style: InspectColor,
	color: Colorize,
	colorEnabled: boolean,
): string {
	const { fullCells, partialCell, emptyCells } =
		renderProgressBar(remainingPercent);
	if (colorEnabled === false) {
		return `${"█".repeat(fullCells)}${partialCell}${"░".repeat(emptyCells)}`;
	}
	return `${color(backgroundStyle(style), " ".repeat(fullCells))}${color(["bgBlack", style], partialCell)}${color("bgBlack", " ".repeat(emptyCells))}`;
}

function backgroundStyle(style: InspectColor): InspectColor {
	if (style === "green") {
		return "bgGreen";
	}
	if (style === "yellow") {
		return "bgYellow";
	}
	return "bgRed";
}

function usageStyle(remainingPercent: number): InspectColor {
	if (remainingPercent > 50) {
		return "green";
	}
	if (remainingPercent > 20) {
		return "yellow";
	}
	return "red";
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
