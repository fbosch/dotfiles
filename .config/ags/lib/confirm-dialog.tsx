import app from "ags/gtk4/app";
import { Astal } from "ags/gtk4";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import Gdk from "gi://Gdk?version=4.0";
import tokens from "../../../design-system/tokens.json";

// Configuration interface
interface ConfirmConfig {
  icon: string;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmCommand: string;
  variant: "danger" | "warning" | "info" | "suspend";
  audioFile?: string;
  showDelay?: number;
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
    iconColor: tokens.colors.state.error.value,
    confirmBg: tokens.colors.state.error.value,
    confirmHoverBg: tokens.colors.state["error-hover"].value,
    confirmFocusColor: tokens.colors.state.error.value,
    confirmTextColor: "#ffffff",
  },
  warning: {
    iconColor: tokens.colors.state.warning.value,
    confirmBg: tokens.colors.state.warning.value,
    confirmHoverBg: tokens.colors.state["warning-hover"].value,
    confirmFocusColor: tokens.colors.state.warning.value,
    confirmTextColor: tokens.colors.state["warning-text"].value,
  },
  info: {
    iconColor: tokens.colors.accent.primary.value,
    confirmBg: tokens.colors.accent.primary.value,
    confirmHoverBg: tokens.colors.accent.hover.value,
    confirmFocusColor: tokens.colors.accent.primary.value,
    confirmTextColor: "#ffffff",
  },
  suspend: {
    iconColor: tokens.colors.state.purple.value,
    confirmBg: tokens.colors.state.purple.value,
    confirmHoverBg: tokens.colors.state["purple-hover"].value,
    confirmFocusColor: tokens.colors.state.purple.value,
    confirmTextColor: tokens.colors.state["purple-text"].value,
  },
};

let win: Astal.Window | null = null;
let icon: Gtk.Label | null = null;
let title: Gtk.Label | null = null;
let message: Gtk.Label | null = null;
let cancelButton: Gtk.Button | null = null;
let confirmButton: Gtk.Button | null = null;
let isVisible: boolean = false;
let showTimeoutId: number | null = null;
let currentVariant: "danger" | "warning" | "info" | "suspend" | null = null;

function applyStaticCSS() {
  app.apply_css(
    `
    window.confirm-dialog {
      background-color: transparent;
      border: none;
      padding: 40px;
    }
    
    window.confirm-dialog box.dialog-box {
      background-color: rgba(45, 45, 45, 0.90);
      border-radius: 12px;
      padding: 16px;
      min-width: 280px;
      border: 1px solid ${tokens.colors.border.hover.value};
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    
    window.confirm-dialog box.content-box {
      margin-bottom: 16px;
    }
    
    window.confirm-dialog label.dialog-icon {
      font-size: 36px;
      margin-bottom: 12px;
    }
    
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
    
    window.confirm-dialog button.dialog-button label {
      color: inherit;
    }
    
    window.confirm-dialog button.cancel {
      background-color: #373737;
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    window.confirm-dialog button.cancel:hover {
      background-color: rgba(55, 55, 55, 0.9);
      border-color: rgba(255, 255, 255, 0.2);
    }
    
    window.confirm-dialog button.cancel:focus {
      outline: 2px solid rgba(255, 255, 255, 0.3);
      outline-offset: 2px;
    }
    
    window.confirm-dialog button.cancel:active {
      transform: scale(0.98);
    }
    
    window.confirm-dialog button.confirm {
      border: none;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    }
    
    window.confirm-dialog button.confirm:hover {
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    
    window.confirm-dialog button.confirm:active {
      transform: scale(0.98);
    }
  `,
    false,
  );
}

function updateVariantCSS(variant: "danger" | "warning" | "info" | "suspend") {
  if (currentVariant === variant) return;
  currentVariant = variant;

  const colors = variants[variant];

  app.apply_css(
    `
    window.confirm-dialog label.dialog-icon {
      color: ${colors.iconColor};
    }

    window.confirm-dialog button.confirm {
      background-color: ${colors.confirmBg};
      color: ${colors.confirmTextColor};
    }

    window.confirm-dialog button.confirm:hover {
      background-color: ${colors.confirmHoverBg};
    }

    window.confirm-dialog button.confirm:focus {
      outline: 2px solid ${colors.confirmFocusColor};
      outline-offset: 2px;
    }
  `,
    false,
  );
}

function hideDialog() {
  if (win) {
    win.set_visible(false);
    isVisible = false;
  }
  if (showTimeoutId !== null) {
    GLib.source_remove(showTimeoutId);
    showTimeoutId = null;
  }
}

function showDialog(config: ConfirmConfig) {
  if (isVisible) {
    return;
  }

  isVisible = true;
  currentConfig = config;

  if (!win) {
    createWindow();
  }

  if (config.audioFile) {
    try {
      GLib.spawn_command_line_async(`pw-play ${config.audioFile}`);
    } catch (e) {
      console.error(`Failed to play audio: ${e}`);
    }
  }

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

  updateVariantCSS(config.variant);

  const showWindow = () => {
    if (win) {
      win.set_visible(true);
      if (cancelButton) cancelButton.grab_focus();
    }
    showTimeoutId = null;
  };

  if (showTimeoutId !== null) {
    GLib.source_remove(showTimeoutId);
  }

  if (config.showDelay && config.showDelay > 0) {
    showTimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      config.showDelay,
      () => {
        showWindow();
        return false;
      },
    );
  } else {
    showWindow();
  }
}

function createWindow() {
  win = (
    <window
      name="confirm-dialog"
      namespace="ags-confirm"
      visible={false}
      anchor={Astal.WindowAnchor.NONE}
      layer={Astal.Layer.OVERLAY}
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
      keymode={Astal.Keymode.EXCLUSIVE}
      class="confirm-dialog"
      application={app}
      $={(self: Astal.Window) => {
        const keyController = new Gtk.EventControllerKey();
        keyController.connect(
          "key-pressed",
          (_: Gtk.EventControllerKey, keyval: number) => {
            if (keyval === Gdk.KEY_Escape) {
              hideDialog();
              return true;
            }
            return false;
          },
        );
        self.add_controller(keyController);
      }}
    >
      <box orientation={Gtk.Orientation.VERTICAL} spacing={0} class="dialog-box">
        <box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={0}
          halign={Gtk.Align.CENTER}
          class="content-box"
        >
          <label
            label={currentConfig.icon}
            halign={Gtk.Align.CENTER}
            class="dialog-icon"
            $={(self: Gtk.Label) => {
              icon = self;
            }}
          />
          <label
            label={currentConfig.title}
            halign={Gtk.Align.CENTER}
            class="dialog-title"
            $={(self: Gtk.Label) => {
              title = self;
            }}
          />
          <label
            label={currentConfig.message}
            halign={Gtk.Align.CENTER}
            class="dialog-message"
            $={(self: Gtk.Label) => {
              message = self;
            }}
          />
        </box>

        <box
          orientation={Gtk.Orientation.HORIZONTAL}
          spacing={8}
          homogeneous={true}
        >
          <button
            canFocus={true}
            hexpand={true}
            halign={Gtk.Align.FILL}
            class="dialog-button cancel"
            onClicked={() => hideDialog()}
            $={(self: Gtk.Button) => {
              cancelButton = self;
              self.set_cursor_from_name("pointer");
            }}
          >
            <label label={currentConfig.cancelLabel} />
          </button>

          <button
            canFocus={true}
            hexpand={true}
            halign={Gtk.Align.FILL}
            class="dialog-button confirm"
            onClicked={() => {
              if (currentConfig.confirmCommand) {
                GLib.spawn_command_line_async(currentConfig.confirmCommand);
              }
              hideDialog();
            }}
            $={(self: Gtk.Button) => {
              confirmButton = self;
              self.set_cursor_from_name("pointer");
            }}
          >
            <label label={currentConfig.confirmLabel} />
          </button>
        </box>
      </box>
    </window>
  ) as Astal.Window;

  updateVariantCSS(currentConfig.variant);
}

// Functions for bundled mode (using global namespace pattern)
function initConfirmDialog() {
  applyStaticCSS();
  // Window created lazily on first show (see showDialog line 218)
}

function handleConfirmDialogRequest(argv: string[], res: (response: any) => void) {
  try {
    const request = argv.join(" ");
    
    if (!request || request.trim() === "") {
      res("ready");
      return;
    }
    
    const data = JSON.parse(request);

    if (data.action === "show") {
      showDialog(data.config);
      res("shown");
    } else if (data.action === "hide") {
      hideDialog();
      res("hidden");
    } else {
      res("unknown action");
    }
  } catch (e) {
    console.error("Error handling confirm-dialog request:", e);
    res("error: " + e);
  }
}

// Make component available globally
globalThis.ConfirmDialog = {
  init: initConfirmDialog,
  handleRequest: handleConfirmDialogRequest,
  instanceName: "confirm-dialog"
};
