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

export const bundledCss = [
	themeCss,
	buttonCss,
	gamingOpacityCss,
	aiPointerCss,
	audioMixerCss,
	calendarCss,
	confirmDialogCss,
	desktopClockCss,
	forceQuitCss,
	keyboardSwitcherCss,
	pipSnapPreviewCss,
	startMenuCss,
	volumeIndicatorCss,
	windowSwitcherCss,
].join("\n");
