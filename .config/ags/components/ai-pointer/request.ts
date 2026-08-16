import { P } from "ts-pattern";

const coordinate = P.when(
	(value): value is number => typeof value === "number" && Number.isSafeInteger(value),
);

const closedPointAction = (action: "start" | "finish") =>
	P.intersection(
		{ action, x: coordinate, y: coordinate },
		P.when((value) => {
			if (typeof value !== "object" || value === null || Array.isArray(value))
				return false;
			return Object.keys(value).every((key) => ["action", "x", "y"].includes(key));
		}),
	);

export const aiPointerRequestPattern = P.union(
	closedPointAction("start"),
	closedPointAction("finish"),
	P.intersection(
		{ action: "cancel" },
		P.when((value) => {
			if (typeof value !== "object" || value === null || Array.isArray(value))
				return false;
			return Object.keys(value).every((key) => key === "action");
		}),
	),
);

export type AiPointerRequest = P.infer<typeof aiPointerRequestPattern>;
