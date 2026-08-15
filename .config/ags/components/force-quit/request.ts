import { P } from "ts-pattern";

export const forceQuitRequestPattern = P.union(
	{ action: "show" },
	{ action: "hide" },
	{ action: "destroy" },
	{ action: "is-visible" },
);

export type ForceQuitRequest = P.infer<typeof forceQuitRequestPattern>;
