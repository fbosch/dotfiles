import app from "ags/gtk4/app";
import tokens from "../../../../design-system/tokens.json";
import {
	calculatedSizes,
	layoutGeometry,
	sizeConfigs,
	type KeyboardSwitcherSize,
} from "./model";

let applied = false;
const appliedGeometry = new Set<string>();

function sizeCss(size: KeyboardSwitcherSize): string {
	const config = sizeConfigs[size];
	const dimensions = calculatedSizes[size];
	return `
window.keyboard-layout-switcher.size-${size} box.keyboard-switcher-container {
  padding: ${config.containerPadding};
}
window.keyboard-layout-switcher.size-${size} box.pill-background {
  min-width: ${dimensions.fullBadgeWidth}px;
  min-height: ${dimensions.fullBadgeHeight}px;
}
window.keyboard-layout-switcher.size-${size} label.layout-badge {
  font-size: ${config.fontSize};
  padding: ${config.badgePaddingY} ${config.badgePaddingX};
  min-width: ${config.minWidth};
}`;
}

export function applyKeyboardSwitcherGeometry(
	size: KeyboardSwitcherSize,
	layoutCount: number,
): void {
	const count = Math.max(1, layoutCount);
	const key = `${size}:${count}`;
	if (appliedGeometry.has(key)) return;
	appliedGeometry.add(key);
	const geometry = layoutGeometry(size, count);
	const positions = geometry.offsets
		.map(
			(offset, index) => `
window.keyboard-layout-switcher.size-${size}.layout-count-${count} box.pill-background.position-${index} {
  transform: translateX(${offset}px);
}`,
		)
		.join("\n");
	app.apply_css(
		`
window.keyboard-layout-switcher.size-${size}.layout-count-${count} box.keyboard-switcher-container {
  min-width: ${geometry.containerWidth}px;
}
window.keyboard-layout-switcher.size-${size}.layout-count-${count} overlay,
window.keyboard-layout-switcher.size-${size}.layout-count-${count} box.pill-wrapper,
window.keyboard-layout-switcher.size-${size}.layout-count-${count} box.badges-container {
  min-width: ${geometry.innerWidth}px;
}
${positions}
`,
		false,
	);
}

export function applyKeyboardSwitcherStyles(): void {
	if (applied) return;
	applied = true;
	app.apply_css(
		`
window.keyboard-layout-switcher {
  background-color: transparent;
  border: none;
}
window.keyboard-layout-switcher box.shadow-wrapper {
  padding: 24px;
  opacity: 0;
  transition: opacity 100ms cubic-bezier(0.4, 0, 0.2, 1);
}
window.keyboard-layout-switcher box.shadow-wrapper.visible { opacity: 1; }
window.keyboard-layout-switcher box.shadow-wrapper.hiding {
  opacity: 0;
  transition: opacity 50ms cubic-bezier(0.4, 0, 1, 1);
}
window.keyboard-layout-switcher box.keyboard-switcher-container {
  background-color: ${tokens.colors.background.tertiary.value}cc;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 9999px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}
window.keyboard-layout-switcher box.pill-background {
  background-color: ${tokens.colors.accent.primary.value};
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 9999px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transform: translateX(0px);
  transition: transform 300ms cubic-bezier(0.4, 0, 0.1, 1);
}
window.keyboard-layout-switcher box.badges-container {
  margin: 0;
  padding: 0;
}
window.keyboard-layout-switcher label.layout-badge {
  font-family: "${tokens.typography.fontFamily.button.value}", "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
  font-weight: 700;
  border-radius: 9999px;
  color: ${tokens.colors.foreground.tertiary.value};
  background-color: transparent;
  border: 1px solid transparent;
  transition: color 200ms ease;
}
window.keyboard-layout-switcher label.layout-badge.active {
  color: ${tokens.colors.foreground.primary.value};
}
${sizeCss("sm")}
${sizeCss("md")}
${sizeCss("lg")}
`,
		false,
	);
}
