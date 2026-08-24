import { persistentStylesheets } from "./persistent-stylesheets";
import { themeCss } from "./theme-css";

export const bundledCss = [
	themeCss,
	...persistentStylesheets.map(({ css }) => css),
].join("\n");
