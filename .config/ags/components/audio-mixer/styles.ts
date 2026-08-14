import app from "ags/gtk4/app";
import tokens from "../../../../design-system/tokens.json";

let applied = false;

export function applyAudioMixerStyles(): void {
	if (applied) return;
	applied = true;
	app.apply_css(
		`
window.audio-mixer-widget { background-color: transparent; border: none; padding: 0; }
window.audio-mixer-widget box.audio-mixer-container { background-color: ${tokens.colors.background.secondary.value}e6; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 12px; min-width: 500px; padding: 0; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24), 0 2px 8px rgba(0, 0, 0, 0.12); margin-bottom: 53px; margin-right: 4px; color: ${tokens.colors.foreground.primary.value}; font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif; }
window.audio-mixer-widget box.audio-mixer-footer { border-top: 1px solid rgba(255, 255, 255, 0.1); padding: 12px; }
window.audio-mixer-widget box.audio-mixer-tabs { background-color: ${tokens.colors.background.primary.value}80; border-radius: 8px; padding: 4px; }
window.audio-mixer-widget button.audio-mixer-tab { min-height: 30px; padding: 0 8px; font-size: 16px; font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif; }
window.audio-mixer-widget label.audio-mixer-icon-label { font-family: "Segoe Fluent Icons"; font-size: 16px; color: inherit; }
window.audio-mixer-widget label.audio-mixer-tab-label { font-family: "SF Pro Text", "Segoe Fluent Icons", system-ui, sans-serif; font-size: 12px; color: inherit; }
window.audio-mixer-widget box.audio-mixer-body { padding: 12px; min-height: 70px; }
window.audio-mixer-widget box.audio-mixer-row { background-color: ${tokens.colors.background.primary.value}73; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 8px 10px; margin-bottom: 2px; }
window.audio-mixer-widget box.audio-mixer-row:hover { border-color: rgba(255, 255, 255, 0.16); background-color: rgba(42, 42, 42, 0.62); }
window.audio-mixer-widget box.audio-mixer-row.muted { opacity: 0.72; }
window.audio-mixer-widget box.audio-mixer-row.focused { border-color: ${tokens.colors.accent.primary.value}a6; background-color: ${tokens.colors.background.primary.value}9e; }
window.audio-mixer-widget box.audio-mixer-row-icon { background-color: rgba(255, 255, 255, 0.06); border-radius: 8px; min-width: 36px; min-height: 36px; padding: 0; }
window.audio-mixer-widget box.audio-mixer-row-icon.default { background-color: ${tokens.colors.accent.primary.value}40; color: ${tokens.colors.accent.text.value}; }
window.audio-mixer-widget box.audio-mixer-row-icon.muted { background-color: ${tokens.colors.state.error.value}1f; color: ${tokens.colors.state.error.value}; }
window.audio-mixer-widget box.audio-mixer-row-icon label.audio-mixer-icon-label { font-size: 17px; }
window.audio-mixer-widget image.audio-mixer-app-icon { -gtk-icon-size: 24px; }
window.audio-mixer-widget label.audio-mixer-row-title { color: ${tokens.colors.foreground.primary.value}; font-size: 14px; font-weight: 600; }
window.audio-mixer-widget label.audio-mixer-badge { border-radius: 999px; padding: 2px 8px; font-size: 11px; border: 1px solid ${tokens.colors.accent.primary.value}66; background-color: ${tokens.colors.accent.primary.value}33; color: ${tokens.colors.foreground.primary.value}; }
window.audio-mixer-widget label.audio-mixer-badge.muted { border-color: ${tokens.colors.state.error.value}4d; background-color: ${tokens.colors.state.error.value}1a; color: ${tokens.colors.state.error.value}; }
window.audio-mixer-widget box.audio-mixer-meter-wrapper { margin-top: 2px; }
window.audio-mixer-widget label.audio-mixer-volume-label { color: ${tokens.colors.foreground.tertiary.value}; font-size: 13px; }
window.audio-mixer-widget box.audio-mixer-meter { min-height: 8px; }
window.audio-mixer-widget box.audio-mixer-meter-segment { min-height: 8px; border-radius: 2px; }
window.audio-mixer-widget box.audio-mixer-meter-segment.filled { background-color: ${tokens.colors.accent.primary.value}; }
window.audio-mixer-widget box.audio-mixer-meter-segment.empty { background-color: rgba(255, 255, 255, 0.08); }
window.audio-mixer-widget button.audio-mixer-action { min-height: 24px; padding: 0 8px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1); background-color: rgba(255, 255, 255, 0.06); color: ${tokens.colors.foreground.secondary.value}; font-size: 11px; font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif; }
window.audio-mixer-widget button.audio-mixer-action.icon { min-width: 28px; min-height: 28px; padding: 0; font-size: 15px; }
window.audio-mixer-widget button.audio-mixer-action.icon label { font-family: "Segoe Fluent Icons"; font-size: 15px; }
window.audio-mixer-widget button.audio-mixer-action.default-icon.active { color: ${tokens.colors.accent.text.value}; border-color: ${tokens.colors.accent.primary.value}8c; background-color: ${tokens.colors.accent.primary.value}; }
window.audio-mixer-widget button.audio-mixer-action:hover, window.audio-mixer-widget button.audio-mixer-action:focus { background-color: rgba(255, 255, 255, 0.1); color: ${tokens.colors.foreground.primary.value}; }
window.audio-mixer-widget box.audio-mixer-empty { border: 1px dashed rgba(255, 255, 255, 0.12); border-radius: 8px; background-color: ${tokens.colors.background.primary.value}4d; padding: 0; min-height: 180px; }
window.audio-mixer-widget box.audio-mixer-empty-content { padding: 36px; }
window.audio-mixer-widget box.audio-mixer-empty label.audio-mixer-icon-label { color: rgba(153, 153, 153, 0.6); font-size: 32px; }
window.audio-mixer-widget label.audio-mixer-empty-label { color: ${tokens.colors.foreground.secondary.value}; font-size: 14px; font-weight: 500; }
`,
		false,
	);
}
