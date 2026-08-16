import { isMatching, P } from "ts-pattern";

const boundedString = (maximumLength: number) =>
	P.when(
		(value): value is string =>
			typeof value === "string" &&
			value.trim().length > 0 &&
			value.length <= maximumLength,
	);

const showDelay = P.when(
	(value): value is number =>
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= 0 &&
		value <= 5_000,
);

const pid = P.when(
	(value): value is number =>
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value > 0 &&
		value <= 2_147_483_647,
);

const windowAddress = P.when(
	(value): value is string =>
		typeof value === "string" && /^0x[0-9a-f]+$/i.test(value),
);

const confirmOperationPattern = P.union(
	{ type: "shutdown" },
	{ type: "restart" },
	{ type: "suspend" },
	{ type: "exit-session" },
	{ type: "kill-process", pid },
	{ type: "close-window", address: windowAddress },
);

const confirmConfigPattern = {
	icon: boundedString(8),
	title: boundedString(80),
	message: boundedString(240),
	confirmLabel: boundedString(32),
	cancelLabel: boundedString(32),
	variant: P.union("danger", "warning", "info", "suspend"),
	operation: confirmOperationPattern,
	showDelay: P.optional(showDelay),
	playWarningSound: P.optional(P.boolean),
};

const showRequestPattern = { action: "show", config: confirmConfigPattern };

export const confirmDialogRequestPattern = P.union(
	P.intersection(
		showRequestPattern,
		P.when(
			(value) =>
				hasExactKeys(value, ["action", "config"]) &&
				hasExactKeys(value.config, [
					"icon",
					"title",
					"message",
					"confirmLabel",
					"cancelLabel",
					"variant",
					"operation",
					"showDelay",
					"playWarningSound",
				]) &&
				hasExactOperationKeys(value.config.operation),
		),
	),
	P.intersection(
		{ action: "hide" },
		P.when((value) => hasExactKeys(value, ["action"])),
	),
);

export type ConfirmOperation = P.infer<typeof confirmOperationPattern>;
export type ConfirmConfig = P.infer<typeof confirmConfigPattern>;
export type ConfirmDialogRequest = P.infer<typeof confirmDialogRequestPattern>;

function hasExactKeys(value: unknown, allowedKeys: string[]): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return false;
	return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function hasExactOperationKeys(value: unknown): boolean {
	if (isMatching(confirmOperationPattern, value) === false) return false;
	if (value.type === "kill-process") return hasExactKeys(value, ["type", "pid"]);
	if (value.type === "close-window")
		return hasExactKeys(value, ["type", "address"]);
	return hasExactKeys(value, ["type"]);
}
