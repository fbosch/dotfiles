import app from "ags/gtk4/app";
import tokens from "../../../../design-system/tokens.json";

const size = {
	containerPadding: "6px 12px",
	iconSize: 20,
	squareSize: 8,
	fontSize: 12,
};

let applied = false;

export function applyVolumeIndicatorStyles(): void {
	if (applied) return;
	applied = true;
	app.apply_css(
		`
window.volume-indicator {
  background-color: transparent;
  border: none;
}
window.volume-indicator box.shadow-wrapper {
  padding: 40px;
}
window.volume-indicator box.indicator-container {
  background-color: ${tokens.colors.background.tertiary.value}cc;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 9999px;
  padding: ${size.containerPadding};
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}
window.volume-indicator box.icon-container {
  min-width: ${size.iconSize}px;
  min-height: ${size.iconSize}px;
  margin-right: 12px;
}
window.volume-indicator label.speaker-icon {
  font-family: "Segoe Fluent Icons";
  font-size: ${size.iconSize}px;
  color: ${tokens.colors.foreground.primary.value};
}
window.volume-indicator label.speaker-icon.muted { color: ${tokens.colors.foreground.tertiary.value}; }
window.volume-indicator box.progress-container {
  margin-right: 12px;
  min-height: ${size.squareSize}px;
}
window.volume-indicator box.progress-square {
  min-width: ${size.squareSize}px;
  min-height: ${size.squareSize}px;
  border-radius: 2px;
  transition: background-color 150ms ease;
}
window.volume-indicator box.progress-square.filled { background-color: ${tokens.colors.foreground.primary.value}; }
window.volume-indicator box.progress-square.empty { background-color: ${tokens.colors.foreground.primary.value}33; }
window.volume-indicator label.volume-label {
  font-family: "${tokens.typography.fontFamily.button.value}", "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
  font-weight: 700;
  font-size: ${size.fontSize}px;
  color: ${tokens.colors.foreground.primary.value};
  min-width: 42px;
}
window.volume-indicator label.volume-label.muted { color: ${tokens.colors.foreground.tertiary.value}; }
`,
		false,
	);
}
