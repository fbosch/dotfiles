import app from "ags/gtk4/app";
import tokens from "../../../../design-system/tokens.json";

const enableAnimations = false;

export function applyStartMenuStyles(): void {
	const transition = enableAnimations ? "transition: all 150ms ease;" : "";
	app.apply_css(
		`
    window.start-menu {
      background-color: transparent;
      border: none;
      padding: 0;
    }

    window.start-menu box.start-menu-container {
      background-color: ${tokens.colors.background.secondary.value}d9;
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 8px;
      padding: 8px;
      min-width: 270px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28), 0 4px 12px rgba(0, 0, 0, 0.14);
      margin-bottom: 54px;
      margin-left: 5px;
    }

    window.start-menu box.user-profile {
      padding: 8px 10px;
    }

    window.start-menu box.user-avatar-image,
    window.start-menu box.user-avatar-image image {
      min-width: 32px;
      min-height: 32px;
    }

    window.start-menu box.user-avatar-image image {
      -gtk-icon-size: 32px;
    }

    window.start-menu label.user-name {
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 16px;
      font-weight: 500;
      color: ${tokens.colors.foreground.primary.value};
    }

    window.start-menu box.profile-row {
      margin: 12px 0;
    }

    window.start-menu box.profile-actions {
      padding: 4px;
      border-radius: 999px;
      background-color: ${tokens.colors.background.primary.value}80;
    }

    window.start-menu button.profile-toggle {
      min-width: 32px;
      min-height: 32px;
      padding: 0;
      border-radius: 999px;
      border: none;
      background-color: transparent;
      color: ${tokens.colors.foreground.secondary.value};
    }

    window.start-menu button.profile-toggle:hover {
      background-color: rgba(255, 255, 255, 0.10);
      color: ${tokens.colors.foreground.primary.value};
    }

    window.start-menu button.profile-toggle.profile-active {
      color: ${tokens.colors.foreground.primary.value};
      background-color: ${tokens.colors.accent.primary.value};
    }

    window.start-menu label.profile-toggle-icon {
      font-family: "Segoe Fluent Icons", "Segoe UI Symbol", sans-serif;
      font-size: 16px;
      color: inherit;
    }

    window.start-menu label.profile-gaming-icon,
    window.start-menu label.profile-auto-badge-icon {
      font-family: "Symbols Nerd Font";
    }

    window.start-menu box.profile-auto-badge {
      min-width: 14px;
      min-height: 14px;
      padding: 0;
      border: 2px solid ${tokens.colors.accent.primary.value};
      border-radius: 999px;
      background-color: ${tokens.colors.state.success.value};
    }

    window.start-menu label.profile-auto-badge-icon {
      padding: 0;
      color: ${tokens.colors.state["success-text"].value};
      font-size: 9px;
    }

    window.start-menu box.profile-labels label {
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 12px;
      font-weight: 500;
      color: ${tokens.colors.foreground.primary.value};
    }

    window.start-menu box.profile-labels {
      padding: 0 4px;
    }

    window.start-menu button.menu-item {
      padding: 0 10px;
      font-size: 14px;
      border-radius: 6px;
      min-height: 36px;
      ${transition}
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      border: none;
      background-color: transparent;
    }

    window.start-menu button.menu-item:hover {
      background-color: rgba(255, 255, 255, 0.1);
    }

    window.start-menu button.menu-item.submenu-open {
      background-color: ${tokens.colors.accent.primary.value};
      color: ${tokens.colors.foreground.primary.value};
    }

    window.start-menu button.menu-item:focus {
      outline: 2px solid rgba(255, 255, 255, 0.3);
      outline-offset: 2px;
    }

    window.start-menu button.menu-item:active {
      transform: scale(0.98);
    }

    window.start-menu button.menu-variant-default {
      color: ${tokens.colors.foreground.primary.value};
    }

    window.start-menu button.menu-variant-default:hover,
    window.start-menu button.menu-variant-default:focus {
      background-color: ${tokens.colors.foreground.primary.value}1a;
    }

    window.start-menu button.menu-variant-warning {
      color: ${tokens.colors.foreground.primary.value};
    }

    window.start-menu button.menu-variant-warning:hover,
    window.start-menu button.menu-variant-warning:focus {
      color: ${tokens.colors.state.warning.value};
      background-color: ${tokens.colors.state.warning.value}1a;
    }

    window.start-menu button.menu-variant-danger {
      color: ${tokens.colors.foreground.primary.value};
    }

    window.start-menu button.menu-variant-danger:hover,
    window.start-menu button.menu-variant-danger:focus {
      color: ${tokens.colors.state.error.value};
      background-color: ${tokens.colors.state.error.value}1a;
    }

    window.start-menu button.menu-variant-purple {
      color: ${tokens.colors.foreground.primary.value};
    }

    window.start-menu button.menu-variant-purple:hover,
    window.start-menu button.menu-variant-purple:focus {
      color: ${tokens.colors.state.purple.value};
      background-color: ${tokens.colors.state.purple.value}1a;
    }

    window.start-menu label.menu-item-icon {
      font-family: "Segoe Fluent Icons", "Segoe UI Symbol", sans-serif;
      font-size: 12px;
      min-width: 16px;
    }

    window.start-menu label.menu-item-chevron {
      font-family: "Segoe Fluent Icons", "Segoe UI Symbol", sans-serif;
      font-size: 10px;
    }

    window.start-menu label.menu-item-label {
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 14px;
      color: inherit;
    }

    window.start-menu box.updates-badge {
      background-color: ${tokens.colors.accent.primary.value};
      color: ${tokens.colors.foreground.primary.value};
      min-width: 18px;
      min-height: 18px;
      padding: 2px 6px;
      border-radius: 999px;
    }

    window.start-menu label.updates-badge-icon {
      font-family: "${tokens.typography.fontFamily.symbols.value}", sans-serif;
      font-size: 12px;
      font-weight: 700;
      color: inherit;
    }

    window.start-menu label.updates-badge-count {
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 12px;
      font-weight: 700;
      color: inherit;
    }

    window.start-menu label.updates-badge-nix-icon {
      transform: translate(0, -0.5px);
    }

    window.start-menu separator.menu-divider {
      background-color: rgba(255, 255, 255, 0.1);
      min-height: 1px;
      margin: 6px 0;
    }

    window.start-menu box.recent-items-menu {
      min-width: 320px;
      padding: 8px;
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 8px;
      background-color: ${tokens.colors.background.secondary.value}d9;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28), 0 4px 12px rgba(0, 0, 0, 0.14);
    }

    window.start-menu label.recent-items-heading {
      padding: 6px 10px 4px;
      color: ${tokens.colors.foreground.secondary.value};
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 12px;
      font-weight: 600;
    }

    window.start-menu button.recent-item,
    window.start-menu button.recent-items-clear {
      min-height: 36px;
      padding: 0 10px;
      border: none;
      border-radius: 6px;
      background-color: transparent;
      color: ${tokens.colors.foreground.primary.value};
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
    }

    window.start-menu button.recent-item:hover,
    window.start-menu button.recent-items-clear:hover {
      background-color: rgba(255, 255, 255, 0.10);
    }

    window.start-menu button.recent-item:focus,
    window.start-menu button.recent-items-clear:focus {
      outline: 2px solid rgba(255, 255, 255, 0.3);
      outline-offset: -2px;
    }

    window.start-menu button.recent-item:active,
    window.start-menu button.recent-items-clear:active {
      background-color: rgba(255, 255, 255, 0.16);
    }

    window.start-menu button.recent-item:disabled,
    window.start-menu button.recent-items-clear:disabled {
      opacity: 0.72;
    }

    window.start-menu image.recent-item-icon,
    window.start-menu box.recent-item-fallback {
      min-width: 18px;
      min-height: 18px;
    }

    window.start-menu box.recent-item-fallback {
      border-radius: 4px;
      background-color: rgba(255, 255, 255, 0.10);
    }

    window.start-menu box.recent-item-fallback label {
      color: ${tokens.colors.foreground.primary.value};
      font-size: 11px;
      font-weight: 600;
    }

    window.start-menu label.recent-item-label {
      color: ${tokens.colors.foreground.primary.value};
      font-size: 14px;
    }

    window.start-menu label.recent-item-detail {
      color: ${tokens.colors.foreground.tertiary.value};
      font-size: 11px;
    }

    window.start-menu label.recent-items-empty {
      padding: 16px 10px;
      color: ${tokens.colors.foreground.tertiary.value};
      font-size: 14px;
    }

    window.start-menu box.recent-items-divider {
      min-height: 1px;
      margin: 6px 0;
      background-color: rgba(255, 255, 255, 0.1);
    }

    window.start-menu label.recent-items-clear-icon {
      font-family: "Segoe Fluent Icons", "Segoe UI Symbol", sans-serif;
      font-size: 12px;
    }
  `,
		false,
	);
}
