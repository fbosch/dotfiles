import { z } from "zod";

export const terminalTextSchema = z
	.string()
	.refine((value) => /[\u0000-\u001f\u007f-\u009f]/u.test(value) === false);

export const optionalDateSchema = z
	.string()
	.refine((value) => Number.isNaN(Date.parse(value)) === false)
	.nullish();
