import { isMatching, P } from "ts-pattern";
import { createPreparationRequestPattern } from "@/services/preparation-intent";

export const startMenuPreparationSource = "waybar:startbutton" as const;
export type StartMenuPreparationSource = typeof startMenuPreparationSource;

const startMenuRequestPattern = P.union(
	{ action: "show" },
	{ action: "hide" },
	{ action: "toggle" },
	{ action: "is-visible" },
	{ action: "refresh" },
	createPreparationRequestPattern(startMenuPreparationSource),
);

export type StartMenuRequest = P.infer<typeof startMenuRequestPattern>;

export function parseStartMenuRequest(value: unknown): StartMenuRequest | null {
	return isMatching(startMenuRequestPattern, value) ? value : null;
}
