import app from "ags/gtk4/app";
import tokens from "../../../../design-system/tokens.json";

let applied = false;

export function applyAboutThisPCStyles(): void {
	if (applied) return;
	applied = true;
	app.apply_css(
		`
window.about-this-pc { background-color: transparent; border: none; padding: 0; }
window.about-this-pc box.about-container {
  min-width: 420px; min-height: 560px;
  border: 1px solid ${tokens.colors.border.hover.value}; border-radius: 12px;
  background-color: ${tokens.colors.background.secondary.value}e6;
}
window.about-this-pc overlay.about-titlebar { min-height: 36px; }
window.about-this-pc button.about-close { min-width: 32px; min-height: 32px; padding: 0; margin: 3px 4px 0 0; }
window.about-this-pc button.about-close label { font-family: "Segoe Fluent Icons", "Segoe UI Symbol", sans-serif; font-size: 12px; }
window.about-this-pc box.about-content { padding: 0 32px 28px; }
window.about-this-pc box.about-artwork { min-height: 144px; }
window.about-this-pc box.about-artwork picture { min-width: 320px; min-height: 144px; }
window.about-this-pc label.about-device-icon { min-width: 320px; min-height: 144px; color: ${tokens.colors.foreground.secondary.value}; font-family: "Segoe Fluent Icons", "Segoe UI Symbol", sans-serif; font-size: 72px; }
window.about-this-pc label.about-device-name { margin-top: 12px; color: ${tokens.colors.foreground.primary.value}; font-size: 24px; font-weight: 600; }
window.about-this-pc label.about-manufacturer { margin-top: 2px; color: ${tokens.colors.foreground.tertiary.value}; font-size: 14px; }
window.about-this-pc box.about-details { margin: 24px 12px 0; }
window.about-this-pc box.about-detail-row { min-height: 23px; }
window.about-this-pc label.about-detail-label { min-width: 68px; margin-right: 16px; color: ${tokens.colors.foreground.primary.value}; font-size: 14px; font-weight: 500; }
window.about-this-pc label.about-detail-icon { color: ${tokens.colors.foreground.secondary.value}; font-family: "Symbols Nerd Font", monospace; font-size: 14px; }
window.about-this-pc label.about-detail-value { color: ${tokens.colors.foreground.secondary.value}; font-size: 14px; }
window.about-this-pc label.about-status { margin-top: 8px; color: ${tokens.colors.state.error.value}; font-size: 13px; }
window.about-this-pc box.about-actions { padding-top: 20px; }
window.about-this-pc button.about-more-info { min-height: 32px; padding: 4px 12px; font-weight: 600; }
`,
		false,
	);
}
