import app from "ags/gtk4/app";
import Gtk from "gi://Gtk?version=4.0";
import tokens from "../../../design-system/tokens.json";

export type ButtonVariant = "primary" | "transparent";

interface ButtonOptions {
  variant: ButtonVariant;
  className?: string;
  hexpand?: boolean;
  onClick?: () => void;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "button-variant-primary",
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

    button.ags-button.button-variant-primary {
      background-color: ${tokens.colors.accent.primary.value};
      color: #ffffff;
    }

    button.ags-button.button-variant-primary:hover {
      background-color: ${tokens.colors.accent.hover.value};
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
  for (const className of Object.values(variantClasses)) {
    button.remove_css_class(className);
  }
  button.add_css_class(variantClasses[variant]);
}

export function createButton({ variant, className, hexpand, onClick }: ButtonOptions): Gtk.Button {
  applyStyles();

  const button = new Gtk.Button();
  button.add_css_class("ags-button");
  setButtonVariant(button, variant);
  if (className) button.add_css_class(className);
  if (hexpand) button.set_hexpand(true);
  if (onClick) button.connect("clicked", onClick);
  button.set_cursor_from_name("pointer");
  return button;
}
