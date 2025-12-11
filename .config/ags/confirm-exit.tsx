import app from "ags/gtk4/app";
import { Astal } from "ags/gtk4";

const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;

// Parse command line arguments for configuration
interface ConfirmConfig {
  icon: string;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmCommand: string;
  variant: "danger" | "warning" | "info";
}

function parseArgs(): ConfirmConfig {
  const args = ARGV || [];
  const config: ConfirmConfig = {
    icon: "⚠",
    title: "Are you sure",
    message: "High-impact operation, please confirm",
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
    confirmCommand: "uwsm stop",
    variant: "danger",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--icon" && args[i + 1]) config.icon = args[++i];
    if (arg === "--title" && args[i + 1]) config.title = args[++i];
    if (arg === "--message" && args[i + 1]) config.message = args[++i];
    if (arg === "--confirm-label" && args[i + 1]) config.confirmLabel = args[++i];
    if (arg === "--cancel-label" && args[i + 1]) config.cancelLabel = args[++i];
    if (arg === "--confirm-command" && args[i + 1]) config.confirmCommand = args[++i];
    if (arg === "--variant" && args[i + 1]) config.variant = args[++i] as "danger" | "warning" | "info";
  }

  return config;
}

const config = parseArgs();

// Variant color schemes
const variants = {
  danger: {
    iconColor: "#e74c3c",
    confirmColor: "#e74c3c",
    confirmFocusColor: "#e74c3c",
    confirmHoverColor: "#ff6b5a",
  },
  warning: {
    iconColor: "#f39c12",
    confirmColor: "#f39c12",
    confirmFocusColor: "#f39c12",
    confirmHoverColor: "#ffb84d",
  },
  info: {
    iconColor: "#3498db",
    confirmColor: "#3498db",
    confirmFocusColor: "#3498db",
    confirmHoverColor: "#5dade2",
  },
};

const colors = variants[config.variant];

app.start({
  css: `
    window.confirm-dialog {
      background-color: rgba(0, 0, 0, 0);
      background: none;
      border: none;
      padding: 40px;
    }
    
    box.dialog-box {
      background-color: #2a2a2a;
      border-radius: 12px;
      padding: 28px 32px 24px 32px;
      min-width: 360px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.3);
    }
    
    box.content-box {
      margin-bottom: 20px;
    }
    
    label.dialog-icon {
      font-size: 38px;
      color: ${colors.iconColor};
      margin-bottom: 12px;
    }
    
    label.dialog-title {
      font-family: "JetBrains Mono", "SF Pro Rounded", system-ui, sans-serif;
      font-size: 17px;
      font-weight: 600;
      color: #ffffff;
      letter-spacing: -0.2px;
      margin-bottom: 6px;
    }
    
    label.dialog-message {
      font-family: "JetBrains Mono", "SF Pro Rounded", system-ui, sans-serif;
      font-size: 13px;
      font-weight: 400;
      color: #999999;
    }
    
    button.dialog-button {
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 500;
      border-radius: 6px;
      min-height: 34px;
      transition: background-color 150ms ease, color 150ms ease;
    }
    
    button.dialog-button label {
      font-family: "JetBrains Mono", "SF Pro Rounded", system-ui, sans-serif;
      color: inherit;
    }
    
    button.cancel {
      background-color: #3b5998;
      color: #ffffff;
      border: none;
    }
    
    button.cancel:hover {
      background-color: #4a6bb3;
    }
    
    button.cancel:focus {
      outline: 2px solid #5a9fd4;
      outline-offset: 2px;
    }
    
    button.confirm {
      background-color: transparent;
      color: ${colors.confirmColor};
      border: none;
    }
    
    button.confirm:hover {
      color: ${colors.confirmHoverColor};
    }
    
    button.confirm:focus {
      outline: 2px solid ${colors.confirmFocusColor};
      outline-offset: 2px;
    }
  `,
  main() {
    const win = new Astal.Window({
      name: "confirm-dialog",
      namespace: "ags-confirm",
      visible: true,
    });
    
    win.set_anchor(Astal.WindowAnchor.CENTER);
    win.set_layer(Astal.Layer.OVERLAY);
    win.set_exclusivity(Astal.Exclusivity.EXCLUSIVE);
    win.set_keymode(Astal.Keymode.EXCLUSIVE);
    
    win.add_css_class("confirm-dialog");
    
    // Add escape key handler
    const keyController = new Gtk.EventControllerKey();
    keyController.connect("key-pressed", (_, keyval) => {
      if (keyval === Gdk.KEY_Escape) {
        app.quit();
        return true;
      }
      return false;
    });
    win.add_controller(keyController);
    
    // Build UI programmatically to ensure proper layout
    const dialogBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 0,
    });
    dialogBox.add_css_class("dialog-box");
    
    // Content section with icon, title, message
    const contentBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 8,
      halign: Gtk.Align.CENTER,
    });
    contentBox.add_css_class("content-box");
    
    const icon = new Gtk.Label({ label: config.icon, halign: Gtk.Align.CENTER });
    icon.add_css_class("dialog-icon");
    
    const title = new Gtk.Label({ label: config.title, halign: Gtk.Align.CENTER });
    title.add_css_class("dialog-title");
    
    const message = new Gtk.Label({ label: config.message, halign: Gtk.Align.CENTER });
    message.add_css_class("dialog-message");
    
    contentBox.append(icon);
    contentBox.append(title);
    contentBox.append(message);
    
    // Button section
    const buttonBox = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 8,
      homogeneous: false,
    });
    
    const cancelButton = new Gtk.Button({ hexpand: true, can_focus: true });
    cancelButton.add_css_class("dialog-button");
    cancelButton.add_css_class("cancel");
    cancelButton.set_child(new Gtk.Label({ label: config.cancelLabel }));
    cancelButton.connect("clicked", () => app.quit());
    
    const confirmButton = new Gtk.Button({ hexpand: true, can_focus: true });
    confirmButton.add_css_class("dialog-button");
    confirmButton.add_css_class("confirm");
    confirmButton.set_child(new Gtk.Label({ label: config.confirmLabel }));
    confirmButton.connect("clicked", () => {
      if (config.confirmCommand) {
        GLib.spawn_command_line_async(config.confirmCommand);
      }
      app.quit();
    });
    
    buttonBox.append(cancelButton);
    buttonBox.append(confirmButton);
    
    // Assemble everything
    dialogBox.append(contentBox);
    dialogBox.append(buttonBox);
    win.set_child(dialogBox);
    
    // Focus cancel button after window is fully assembled
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      cancelButton.grab_focus();
      return GLib.SOURCE_REMOVE;
    });
    
    return win;
  },
});
