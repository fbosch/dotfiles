import aboutThisPcCss from "../components/about-this-pc/styles.scss";
import aiPointerCss from "../components/ai-pointer/styles.scss";
import audioMixerCss from "../components/audio-mixer/styles.scss";
import calendarCss from "../components/calendar/styles.scss";
import confirmDialogCss from "../components/confirm-dialog/styles.scss";
import desktopClockCss from "../components/desktop-clock/styles.scss";
import forceQuitCss from "../components/force-quit/styles.scss";
import keyboardSwitcherCss from "../components/keyboard-switcher/styles.scss";
import pipSnapPreviewCss from "../components/pip-snap-preview/styles.scss";
import startMenuCss from "../components/start-menu/styles.scss";
import volumeIndicatorCss from "../components/volume-indicator/styles.scss";
import windowSwitcherCss from "../components/window-switcher/styles.scss";
import buttonCss from "./button.scss";
import gamingOpacityCss from "./gaming-opacity.scss";
import { themeCss } from "./theme-css";

export interface Stylesheet {
	name: string;
	css: string;
}

export const componentStylesheets: Stylesheet[] = [
	{ name: "button", css: buttonCss },
	{ name: "gaming-opacity", css: gamingOpacityCss },
	{ name: "about-this-pc", css: aboutThisPcCss },
	{ name: "ai-pointer", css: aiPointerCss },
	{ name: "audio-mixer", css: audioMixerCss },
	{ name: "calendar", css: calendarCss },
	{ name: "confirm-dialog", css: confirmDialogCss },
	{ name: "desktop-clock", css: desktopClockCss },
	{ name: "force-quit", css: forceQuitCss },
	{ name: "keyboard-switcher", css: keyboardSwitcherCss },
	{ name: "pip-snap-preview", css: pipSnapPreviewCss },
	{ name: "start-menu", css: startMenuCss },
	{ name: "volume-indicator", css: volumeIndicatorCss },
	{ name: "window-switcher", css: windowSwitcherCss },
];

export const bundledCss = [
	themeCss,
	...componentStylesheets.map(({ css }) => css),
].join("\n");
