import app from "ags/gtk4/app";
import Gtk from "gi://Gtk?version=4.0";
import tokens from "../../../design-system/tokens.json";

export type ButtonVariant = "default" | "primary" | "warning" | "danger" | "suspend" | "transparent";

interface ButtonOptions {
  variant: ButtonVariant;
  className?: string;
  hexpand?: boolean;
  onClick?: () => void;
}

const variantClasses: Record<ButtonVariant, string> = {
  default: "button-variant-default",
  primary: "button-variant-primary",
  warning: "button-variant-warning",
  danger: "button-variant-danger",
  suspend: "button-variant-suspend",
  transparent: "button-variant-transparent",
};

let stylesApplied = false;

function applyStyles(): void {
  if (stylesApplied) return;
  stylesApplied = true;

  app.apply_css(
    `
    button.ags-button {
      border: none;
      border-radius: 6px;
    }

    button.ags-button:disabled {
      opacity: 0.4;
    }

    button.ags-button label {
      color: inherit;
    }

    button.ags-button.button-variant-default {
      background-color: #373737;
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    button.ags-button.button-variant-default:hover {
      background-color: rgba(55, 55, 55, 0.9);
      border-color: rgba(255, 255, 255, 0.2);
    }

    button.ags-button.button-variant-default:focus {
      outline: 2px solid rgba(255, 255, 255, 0.3);
      outline-offset: 2px;
    }

    button.ags-button.button-variant-primary {
      background-color: ${tokens.colors.accent.primary.value};
      color: #ffffff;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 1px 2px rgba(0, 0, 0, 0.05);
    }

    button.ags-button.button-variant-primary:hover {
      background-color: ${tokens.colors.accent.hover.value};
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    button.ags-button.button-variant-primary:focus {
      outline: 2px solid ${tokens.colors.accent.primary.value};
      outline-offset: 2px;
    }

    button.ags-button.button-variant-warning {
      background-color: ${tokens.colors.state.warning.value};
      color: ${tokens.colors.state["warning-text"].value};
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 1px 2px rgba(0, 0, 0, 0.05);
    }

    button.ags-button.button-variant-warning:hover {
      background-color: ${tokens.colors.state["warning-hover"].value};
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    button.ags-button.button-variant-warning:focus {
      outline: 2px solid ${tokens.colors.state.warning.value};
      outline-offset: 2px;
    }

    button.ags-button.button-variant-danger {
      background-color: ${tokens.colors.state.error.value};
      color: #ffffff;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 1px 2px rgba(0, 0, 0, 0.05);
    }

    button.ags-button.button-variant-danger:hover {
      background-color: ${tokens.colors.state["error-hover"].value};
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    button.ags-button.button-variant-danger:focus {
      outline: 2px solid ${tokens.colors.state.error.value};
      outline-offset: 2px;
    }

    button.ags-button.button-variant-suspend {
      background-color: ${tokens.colors.state.purple.value};
      color: ${tokens.colors.state["purple-text"].value};
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 1px 2px rgba(0, 0, 0, 0.05);
    }

    button.ags-button.button-variant-suspend:hover {
      background-color: ${tokens.colors.state["purple-hover"].value};
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    button.ags-button.button-variant-suspend:focus {
      outline: 2px solid ${tokens.colors.state.purple.value};
      outline-offset: 2px;
    }

    button.ags-button.button-variant-transparent {
      background-color: transparent;
      color: ${tokens.colors.foreground.secondary.value};
    }

    button.ags-button.button-variant-transparent:hover,
    button.ags-button.button-variant-transparent:focus {
      background-color: rgba(255, 255, 255, 0.1);
      color: ${tokens.colors.foreground.primary.value};
    }
  `,
    false,
  );
}

export function setButtonVariant(button: Gtk.Button, variant: ButtonVariant): void {
  applyStyles();
  for (const className of Object.values(variantClasses)) {
    button.remove_css_class(className);
  }
  button.add_css_class(variantClasses[variant]);
}

export function configureButton(button: Gtk.Button, { variant, className, hexpand, onClick }: ButtonOptions): void {
  applyStyles();
  button.add_css_class("ags-button");
  setButtonVariant(button, variant);
  if (className) button.add_css_class(className);
  if (hexpand) button.set_hexpand(true);
  if (onClick) button.connect("clicked", onClick);
  button.set_cursor_from_name("pointer");
}

export function createButton(options: ButtonOptions): Gtk.Button {
  const button = new Gtk.Button();
  configureButton(button, options);
  return button;
}
