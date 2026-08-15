import { P } from "ts-pattern";

export const aboutThisPCRequestPattern = P.union(
	{ action: "show" },
	{ action: "hide" },
	{ action: "destroy" },
	{ action: "is-visible" },
);

export type AboutThisPCRequest = P.infer<typeof aboutThisPCRequestPattern>;
