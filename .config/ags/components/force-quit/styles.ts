import app from "ags/gtk4/app";
import tokens from "../../../../design-system/tokens.json";

let applied = false;

export function applyForceQuitStyles(): void {
	if (applied) return;
	applied = true;
	app.apply_css(
		`
window.force-quit { background-color: transparent; border: none; padding: 0; }
window.force-quit box.force-quit-container {
  min-width: 420px; min-height: 500px;
  border: 1px solid ${tokens.colors.border.hover.value}; border-radius: 12px;
  background-color: ${tokens.colors.background.secondary.value}e6;
}
window.force-quit overlay.force-quit-titlebar { min-height: 36px; }
window.force-quit box.force-quit-body { padding: 0 20px 20px; }
window.force-quit label.force-quit-title { color: ${tokens.colors.foreground.primary.value}; font-size: 16px; font-weight: 600; }
window.force-quit button.force-quit-close { min-width: 32px; min-height: 32px; padding: 0; margin: 3px 4px 0 0; }
window.force-quit button.force-quit-close label { font-family: "Segoe Fluent Icons", "Segoe UI Symbol", sans-serif; font-size: 12px; }
window.force-quit label.force-quit-status { color: ${tokens.colors.foreground.tertiary.value}; font-size: 14px; margin: 16px; }
window.force-quit scrolledwindow.force-quit-list { border: 1px solid rgba(255, 255, 255, 0.20); border-radius: 8px; background-color: rgba(0, 0, 0, 0.12); }
window.force-quit box.force-quit-list-content { padding: 4px; }
window.force-quit button.force-quit-row { min-height: 36px; padding: 0 8px; border: none; border-radius: 6px; background-color: transparent; color: ${tokens.colors.foreground.primary.value}; }
window.force-quit button.force-quit-row:hover, window.force-quit button.force-quit-row:focus { background-color: rgba(255, 255, 255, 0.10); }
window.force-quit button.force-quit-row.selected { background-color: ${tokens.colors.accent.primary.value}; color: ${tokens.colors.accent.text.value}; }
window.force-quit image.force-quit-icon, window.force-quit box.force-quit-icon-fallback { min-width: 24px; min-height: 24px; }
window.force-quit box.force-quit-icon-fallback { border-radius: 4px; background-color: rgba(255, 255, 255, 0.10); }
window.force-quit box.force-quit-icon-fallback label { min-width: 24px; min-height: 24px; font-size: 12px; font-weight: 600; }
window.force-quit label.force-quit-name { font-size: 14px; font-weight: 500; color: inherit; }
window.force-quit label.force-quit-metrics { font-size: 13px; color: ${tokens.colors.foreground.tertiary.value}; }
window.force-quit button.force-quit-row.selected label.force-quit-metrics { color: rgba(255, 255, 255, 0.80); }
window.force-quit button.force-quit-action { min-height: 32px; padding: 4px 12px; font-weight: 600; }
`,
		false,
	);
}
