import aboutThisPcCss from "../components/about-this-pc/styles.scss";
import {
	persistentStylesheets,
	type Stylesheet,
} from "./persistent-stylesheets";

export type { Stylesheet };

export const componentStylesheets: Stylesheet[] = [
	...persistentStylesheets,
	{ name: "about-this-pc", css: aboutThisPcCss },
];
