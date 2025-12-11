import app from "ags/gtk4/app";
import { Astal } from "ags/gtk4";

const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;

// Configuration interface
interface ConfirmConfig {
  icon: string;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmCommand: string;
  variant: "danger" | "warning" | "info";
}

// Default config
let currentConfig: ConfirmConfig = {
  icon: "⚠",
  title: "Are you sure",
  message: "High-impact operation, please confirm",
  confirmLabel: "Confirm",
  cancelLabel: "Cancel",
  confirmCommand: "",
  variant: "danger",
};

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

let win: Astal.Window | null = null;
let icon: Gtk.Label | null = null;
let title: Gtk.Label | null = null;
let message: Gtk.Label | null = null;
let cancelButton: Gtk.Button | null = null;
let confirmButton: Gtk.Button | null = null;

function updateCSS(config: ConfirmConfig) {
  const colors = variants[config.variant];
  
  app.apply_css(`
    window.confirm-dialog {
      background-color: rgba(0, 0, 0, 0);
      background: none;
      border: none;
      padding: 40px;
    }
    
    box.dialog-box {
      background-color: #2a2a2a;
      border-radius: 12px;
      padding: 24px 28px 20px 28px;
      min-width: 320px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.3);
    }
    
    box.content-box {
      margin-bottom: 16px;
    }
    
    label.dialog-icon {
      font-size: 32px;
      color: ${colors.iconColor};
      margin-bottom: 10px;
    }
    
    label.dialog-title {
      font-family: "SF Pro Rounded", "SF Pro Text", system-ui, sans-serif;
      font-size: 16px;
      font-weight: 500;
      color: #ffffff;
      letter-spacing: -0.2px;
      margin-bottom: 7px;
    }
    
    label.dialog-message {
      font-family: "SF Pro Rounded", "SF Pro Text", system-ui, sans-serif;
      font-size: 14px;
      font-weight: 400;
      color: #999999;
    }
    
    button.dialog-button {
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 500;
      border-radius: 6px;
      min-height: 30px;
      transition: background-color 150ms ease, color 150ms ease;
    }
    
    button.dialog-button label {
      font-family: "SF Pro Rounded", "SF Pro Text", system-ui, sans-serif;
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
  `, false);
}

function hideDialog() {
  if (win) {
    win.set_visible(false);
  }
}

function showDialog(config: ConfirmConfig) {
  currentConfig = config;
  
  if (!win) {
    createWindow();
  }
  
  // Update content
  if (icon) icon.set_label(config.icon);
  if (title) title.set_label(config.title);
  if (message) message.set_label(config.message);
  if (cancelButton) {
    const label = cancelButton.get_child() as Gtk.Label;
    if (label) label.set_label(config.cancelLabel);
  }
  if (confirmButton) {
    const label = confirmButton.get_child() as Gtk.Label;
    if (label) label.set_label(config.confirmLabel);
  }
  
  // Update CSS for variant colors
  updateCSS(config);
  
  // Show window
  if (win) {
    win.set_visible(true);
    if (cancelButton) cancelButton.grab_focus();
  }
}

function createWindow() {
  win = new Astal.Window({
    name: "confirm-dialog",
    namespace: "ags-confirm",
    visible: false,
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
      hideDialog();
      return true;
    }
    return false;
  });
  win.add_controller(keyController);
  
  // Build UI
  const dialogBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 0,
  });
  dialogBox.add_css_class("dialog-box");
  
  const contentBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 8,
    halign: Gtk.Align.CENTER,
  });
  contentBox.add_css_class("content-box");
  
  icon = new Gtk.Label({ label: currentConfig.icon, halign: Gtk.Align.CENTER });
  icon.add_css_class("dialog-icon");
  
  title = new Gtk.Label({ label: currentConfig.title, halign: Gtk.Align.CENTER });
  title.add_css_class("dialog-title");
  
  message = new Gtk.Label({ label: currentConfig.message, halign: Gtk.Align.CENTER });
  message.add_css_class("dialog-message");
  
  contentBox.append(icon);
  contentBox.append(title);
  contentBox.append(message);
  
  const buttonBox = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 8,
    homogeneous: false,
  });
  
  cancelButton = new Gtk.Button({ hexpand: true, can_focus: true });
  cancelButton.add_css_class("dialog-button");
  cancelButton.add_css_class("cancel");
  cancelButton.set_child(new Gtk.Label({ label: currentConfig.cancelLabel }));
  cancelButton.connect("clicked", () => hideDialog());
  
  confirmButton = new Gtk.Button({ hexpand: true, can_focus: true });
  confirmButton.add_css_class("dialog-button");
  confirmButton.add_css_class("confirm");
  confirmButton.set_child(new Gtk.Label({ label: currentConfig.confirmLabel }));
  confirmButton.connect("clicked", () => {
    if (currentConfig.confirmCommand) {
      GLib.spawn_command_line_async(currentConfig.confirmCommand);
    }
    hideDialog();
  });
  
  buttonBox.append(cancelButton);
  buttonBox.append(confirmButton);
  
  dialogBox.append(contentBox);
  dialogBox.append(buttonBox);
  win.set_child(dialogBox);
  
  updateCSS(currentConfig);
}

// IPC to receive show/hide commands
const configFile = GLib.get_user_runtime_dir() + "/ags-confirm-config.json";

function watchConfig() {
  const file = Gio.File.new_for_path(configFile);
  const monitor = file.monitor(Gio.FileMonitorFlags.NONE, null);
  
  monitor.connect('changed', (monitor, file, other_file, event_type) => {
    if (event_type === Gio.FileMonitorEvent.CHANGED || event_type === Gio.FileMonitorEvent.CREATED) {
      try {
        const [ok, contents] = GLib.file_get_contents(configFile);
        if (ok) {
          const decoder = new TextDecoder();
          const configData = JSON.parse(decoder.decode(contents));
          
          if (configData.action === "show") {
            showDialog(configData.config);
          } else if (configData.action === "hide") {
            hideDialog();
          }
        }
      } catch (e) {
        print("Error reading config:", e);
      }
    }
  });
}

app.start({
  main() {
    createWindow();
    watchConfig();
    return win;
  },
  instanceName: "confirm-dialog-daemon",
});
