import app from "ags/gtk4/app";
import { layoutGeometry, type KeyboardSwitcherSize } from "./model";

const appliedGeometry = new Set<string>();

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
