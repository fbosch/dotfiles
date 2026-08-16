import app from "ags/gtk4/app";
import tokens from "../../../../design-system/tokens.json";

export enum DisplayMode {
	ICONS = "ICONS",
	PREVIEWS = "PREVIEWS",
}

export const ICON_SIZE = 64;

export function applyStaticCss(displayMode: DisplayMode): void {
	const opaque = displayMode === DisplayMode.ICONS;
	const background = opaque
		? tokens.colors.background.primary.value
		: `${tokens.colors.background.primary.value}80`;
	const border = opaque
		? `1px solid ${tokens.colors.background.tertiary.value}`
		: `1px solid ${tokens.colors.border.hover.value}`;
	const backdrop = opaque ? "none" : "blur(20px)";
	const previewBackground = opaque
		? tokens.colors.background.primary.value
		: `${tokens.colors.background.primary.value}f2`;
	const previewHeaderBackground = opaque
		? tokens.colors.background.tertiary.value
		: `${tokens.colors.background.tertiary.value}f2`;
	const previewBodyBackground = opaque
		? tokens.colors.background.primary.value
		: `linear-gradient(135deg, ${tokens.colors.background.tertiary.value}e6 0%, ${tokens.colors.background.primary.value}e6 100%)`;

	app.apply_css(
		`
    window.window-switcher { background-color: transparent; border: none; }
    window.window-switcher box.switcher-container {
      background-color: ${background}; backdrop-filter: ${backdrop};
      border: ${border}; border-radius: 18px; padding: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
    }
    window.window-switcher box.apps-row { min-height: ${ICON_SIZE + 16}px; }
    window.window-switcher button.app-button {
      padding: 8px; border-radius: 12px; border: 2px solid transparent; background-color: transparent;
      transition: all 150ms ease;
    }
    window.window-switcher button.app-button:hover { background-color: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.2); }
    window.window-switcher button.app-button.selected {
      background-color: ${tokens.colors.background.tertiary.value}b3; border-color: ${tokens.colors.accent.primary.value};
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2), 0 0 0 1px ${tokens.colors.accent.primary.value}33 inset;
    }
    window.window-switcher button.app-button.selected:hover { background-color: ${tokens.colors.background.tertiary.value}cc; border-color: ${tokens.colors.accent.primary.value}; }
    window.window-switcher box.icon-container { min-width: ${ICON_SIZE}px; min-height: ${ICON_SIZE}px; border-radius: 12px; }
    window.window-switcher box.icon-container.letter-icon { background-color: ${tokens.colors.accent.primary.value}; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15); }
    window.window-switcher image.app-icon-image { min-width: ${ICON_SIZE}px; min-height: ${ICON_SIZE}px; }
    window.window-switcher label.app-icon-letter {
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif; font-weight: 600; font-size: 28px;
      color: ${tokens.colors.foreground.primary.value}; min-width: ${ICON_SIZE}px; min-height: ${ICON_SIZE}px;
    }
    window.window-switcher label.app-name {
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif; font-size: 14px;
      color: ${tokens.colors.foreground.primary.value}; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    }
    window.window-switcher box.window-preview {
      background-color: ${previewBackground}; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
    }
    window.window-switcher box.preview-header {
      background-color: ${previewHeaderBackground}; border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px 8px 0 0; padding: 8px 12px;
    }
    window.window-switcher image.preview-header-icon { min-width: 20px; min-height: 20px; }
    window.window-switcher box.preview-header-icon-fallback { min-width: 20px; min-height: 20px; border-radius: 4px; background-color: ${tokens.colors.accent.primary.value}; }
    window.window-switcher label.preview-header-letter {
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif; font-weight: 600; font-size: 12px; color: ${tokens.colors.foreground.primary.value};
    }
    window.window-switcher label.preview-header-title {
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif; font-size: 13px; font-weight: 500;
      color: ${tokens.colors.foreground.primary.value};
    }
    window.window-switcher box.preview-body { background: ${previewBodyBackground}; }
    window.window-switcher picture.preview-image { border-radius: 0 0 8px 8px; }
  `,
		false,
	);
}
