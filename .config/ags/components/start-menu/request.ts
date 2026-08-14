import { isMatching, P } from "ts-pattern";

const startMenuRequestPattern = P.union(
	{ action: "show" },
	{ action: "hide" },
	{ action: "toggle" },
	{ action: "is-visible" },
	{ action: "refresh" },
);

export type StartMenuRequest = P.infer<typeof startMenuRequestPattern>;

export function parseStartMenuRequest(value: unknown): StartMenuRequest | null {
	return isMatching(startMenuRequestPattern, value) ? value : null;
}
