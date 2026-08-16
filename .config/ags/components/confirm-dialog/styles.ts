import app from "ags/gtk4/app";
import tokens from "../../../../design-system/tokens.json";

let applied = false;

export function applyConfirmDialogStyles(): void {
	if (applied) return;
	applied = true;
	app.apply_css(
		`
window.confirm-dialog {
  background-color: transparent;
  border: none;
  padding: 40px;
}
window.confirm-dialog box.dialog-box {
  background-color: ${tokens.colors.background.secondary.value}e6;
  border-radius: 12px;
  padding: 16px;
  min-width: 280px;
  border: 1px solid ${tokens.colors.border.hover.value};
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 2px 8px rgba(0, 0, 0, 0.1);
}
window.confirm-dialog box.content-box { margin-bottom: 16px; }
window.confirm-dialog label.dialog-icon { font-size: 36px; margin-bottom: 12px; }
window.confirm-dialog.variant-danger label.dialog-icon { color: ${tokens.colors.state.error.value}; }
window.confirm-dialog.variant-warning label.dialog-icon { color: ${tokens.colors.state.warning.value}; }
window.confirm-dialog.variant-info label.dialog-icon { color: ${tokens.colors.accent.primary.value}; }
window.confirm-dialog.variant-suspend label.dialog-icon { color: ${tokens.colors.state.purple.value}; }
window.confirm-dialog label.dialog-title {
  font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: ${tokens.colors.foreground.primary.value};
  margin-bottom: 6px;
}
window.confirm-dialog label.dialog-message {
  font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
  font-size: 12px;
  font-weight: 400;
  color: ${tokens.colors.foreground.tertiary.value};
  line-height: 1.5;
}
window.confirm-dialog label.dialog-message.operation-error { color: ${tokens.colors.state.error.value}; }
window.confirm-dialog button.dialog-button {
  padding: 4px 12px;
  font-size: 14px;
  font-weight: 700;
  border-radius: 6px;
  min-height: 28px;
  transition: all 150ms ease;
  font-family: "${tokens.typography.fontFamily.button.value}", "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}
window.confirm-dialog button.cancel:active,
window.confirm-dialog button.confirm:active { transform: scale(0.98); }
window.confirm-dialog button.confirm {
  border: none;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}
window.confirm-dialog button.confirm:hover { box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); }
`,
		false,
	);
}
