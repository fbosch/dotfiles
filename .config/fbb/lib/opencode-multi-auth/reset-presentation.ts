import { type InspectColor, styleText } from "node:util";
import { colorProfileName } from "../profile-color.ts";
import { renderAccountCards, type DisplayAccountListProfile } from "./list-presentation.ts";
import { escapeTerminalText } from "./terminal-text.ts";
import type {
	DetailedResetCredit,
	ResetConsumeData,
	ResetPreviewData,
	ResetStatusData,
} from "./reset.ts";

type ResetPresentationOptions = {
	colorEnabled: boolean;
	plain: boolean;
};

type Colorize = (format: InspectColor, value: string) => string;

export function renderResetStatus(
	status: ResetStatusData,
	options: ResetPresentationOptions,
): string {
	const sections = [renderAccountCards(statusProfile(status), options)];
	if (status.active.credits.length > 0) {
		sections[0] += `\n${renderCreditList(status.active.credits, options)}`;
	}
	const errors = status.accounts.filter(
		(account) => account.active && account.error !== null,
	);
	if (errors.length > 0) {
		sections.push(
			[
				"Unavailable",
				...errors.map(
					(account) =>
						`  ${escapeTerminalText(account.profileLabel)}: ${escapeTerminalText(account.error || "unknown error")}`,
				),
			].join("\n"),
		);
	}
	return sections.join("\n\n");
}

export function renderResetPreview(
	preview: ResetPreviewData,
	options: ResetPresentationOptions,
): string {
	if (preview.credit === null) {
		return "Info     No available reset credits.";
	}
	return [
		renderIdentity(preview.profileLabel, preview.displayColor ?? null, options),
		renderCreditDetail(preview.credit, options),
	].join("\n");
}

export function renderResetConsume(
	consume: ResetConsumeData,
	options: ResetPresentationOptions,
): string {
	return [
		renderIdentity(consume.profileLabel, consume.displayColor ?? null, options),
		formatDetailRow("reset credit", "redeemed", options),
		formatDetailRow("windows", String(consume.windowsReset ?? "unknown"), options),
		formatDetailRow(
			"redeemed",
			escapeTerminalText(consume.redeemedAt || "unknown"),
			options,
		),
		formatDetailRow(
			"code",
			escapeTerminalText(consume.code || "unknown"),
			options,
		),
	].join("\n");
}

function statusProfile(status: ResetStatusData): DisplayAccountListProfile[] {
	const usage = new Map(status.active.usage.map((window) => [window.name, window]));
	const nextCredit = status.active.credits.find(
		(credit) => credit.status === "available",
	);
	const account = status.accounts.find((candidate) => candidate.active);
	if (account === undefined) {
		return [];
	}
	return [{
		key: "reset-active",
		generatedLabel: account.profileLabel,
		alias: null,
		active: true,
		displayColor: account.displayColor ?? null,
		usage: {
			primary: usageWindow(usage.get("primary")),
			secondary: usageWindow(usage.get("secondary")),
		},
		resetCredits: {
			availableCount: account.availableCount,
			nextExpiresAt: nextCredit?.expiresAt || null,
			urgency: account.urgency,
		},
	}];
}

function usageWindow(
	window: ResetStatusData["active"]["usage"][number] | undefined,
) {
	return {
		remainingPercent: window?.remaining ?? null,
		resetAt: window?.resetsAt ?? null,
	};
}

function renderCreditList(
	credits: DetailedResetCredit[],
	options: ResetPresentationOptions,
): string {
	return credits.map((credit) => renderCreditDetail(credit, options)).join("\n");
}

function renderCreditDetail(
	credit: DetailedResetCredit,
	options: ResetPresentationOptions,
): string {
	const color: Colorize = options.colorEnabled
		? styleText
		: (_: InspectColor, value: string) => value;
	const urgencyColor = resetUrgencyColor(credit.urgency);
	if (options.plain) {
		return [
			"  Reset credit",
			`    ${color(urgencyColor, escapeTerminalText(credit.status))}`,
			`    expires in ${escapeTerminalText(credit.expiresIn)}`,
			`    type ${escapeTerminalText(credit.resetType || "unknown")}`,
			`    ID ${color("gray", escapeTerminalText(credit.id))}`,
			...(credit.title ? [`    ${escapeTerminalText(credit.title)}`] : []),
		].join("\n");
	}
	const lines = [
		formatDetailRow(
			"reset credit",
			color(urgencyColor, escapeTerminalText(credit.status)),
			options,
		),
		`${"".padEnd(16)}expires in ${escapeTerminalText(credit.expiresIn)}`,
		`${"".padEnd(16)}type ${escapeTerminalText(credit.resetType || "unknown")}`,
		`${"".padEnd(16)}ID ${color("gray", escapeTerminalText(credit.id))}`,
	];
	if (credit.title) {
		lines.push(`${"".padEnd(16)}${escapeTerminalText(credit.title)}`);
	}
	return lines.join("\n");
}

function renderIdentity(
	profileLabel: string,
	displayColor: number | null,
	options: ResetPresentationOptions,
): string {
	const label = escapeTerminalText(profileLabel);
	if (options.plain) {
		return `${label} active`;
	}
	const color: Colorize = options.colorEnabled
		? styleText
		: (_: InspectColor, value: string) => value;
	return `${color("green", "*")} ${colorProfileName(label, displayColor, options.colorEnabled)} ${color("green", "active")}`;
}

function formatDetailRow(
	label: string,
	value: string,
	options: ResetPresentationOptions,
): string {
	if (options.plain) {
		return `  ${capitalize(label)}\n    ${value}`;
	}
	return `  ${label.padEnd(12)}  ${value}`;
}

function capitalize(value: string): string {
	return `${value[0]?.toUpperCase() || ""}${value.slice(1)}`;
}

function resetUrgencyColor(
	urgency: DetailedResetCredit["urgency"],
): InspectColor {
	switch (urgency) {
		case "urgent":
			return "red";
		case "soon":
			return "yellow";
		case "later":
			return "green";
		case "unknown":
			return "gray";
	}
}
