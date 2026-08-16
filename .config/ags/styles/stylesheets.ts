import audioMixerCss from "../components/audio-mixer/styles.scss";
import { themeCss } from "./theme-css";

export interface Stylesheet {
	name: string;
	css: string;
}

export const componentStylesheets: Stylesheet[] = [
	{ name: "audio-mixer", css: audioMixerCss },
];

export const bundledCss = [
	themeCss,
	...componentStylesheets.map(({ css }) => css),
].join("\n");
