import { P } from "ts-pattern";

export const volumeIndicatorRequestPattern = P.union(
	{ action: "show" },
	{ action: "hide" },
	{ action: "get-visibility" },
);

export type VolumeIndicatorRequest = P.infer<
	typeof volumeIndicatorRequestPattern
>;
