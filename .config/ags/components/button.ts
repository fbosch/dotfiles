import Gtk from "gi://Gtk?version=4.0";

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

export function setButtonVariant(button: Gtk.Button, variant: ButtonVariant): void {
  for (const className of Object.values(variantClasses)) {
    button.remove_css_class(className);
  }
  button.add_css_class(variantClasses[variant]);
}

export function configureButton(button: Gtk.Button, { variant, className, hexpand, onClick }: ButtonOptions): void {
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
