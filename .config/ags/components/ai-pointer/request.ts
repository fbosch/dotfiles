import { P } from "ts-pattern";

export const aiPointerRequestPattern = P.intersection(
	{ action: "start" },
	P.when((value) => {
		if (typeof value !== "object" || value === null || Array.isArray(value))
			return false;
		return Object.keys(value).every((key) => key === "action");
	}),
);

export type AiPointerRequest = P.infer<typeof aiPointerRequestPattern>;
