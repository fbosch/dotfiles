import { P } from "ts-pattern";

const sizePattern = P.union("sm", "md", "lg");

export const keyboardSwitcherRequestPattern = P.union(
	{
		action: "show",
		config: {
			layouts: P.array(P.string),
			activeLayout: P.string,
			size: P.optional(sizePattern),
		},
	},
	{ action: "hide" },
	{ action: "get-visibility" },
);

export type KeyboardSwitcherRequest = P.infer<
	typeof keyboardSwitcherRequestPattern
>;
