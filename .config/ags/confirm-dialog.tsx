import app from "ags/gtk4/app";
import { Astal } from "ags/gtk4";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import Gdk from "gi://Gdk?version=4.0";
import tokens from "../../design-system/tokens.json";

// Configuration interface
interface ConfirmConfig {
  icon: string;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmCommand: string;
  variant: "danger" | "warning" | "info" | "suspend";
  audioFile?: string; // Optional audio file to play when showing dialog
  showDelay?: number; // Optional delay in milliseconds before showing dialog
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

// Variant color schemes - imported from design system tokens
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
    confirmTextColor: "#ffffff", // Primary buttons use white text
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

// Apply static CSS once on module load
function applyStaticCSS() {
  app.apply_css(
    `
    /* Window container - transparent backdrop */
    window.confirm-dialog {
      background-color: transparent;
      border: none;
      padding: 40px;
    }
    
    /* Dialog box - matches design-system Dialog component sm size */
    /* bg-background-secondary/90 backdrop-blur-sm rounded-xl p-4 */
    /* border border-white/15 shadow-[0_8px_32px_rgba(0,0,0,0.2),0_2px_8px_rgba(0,0,0,0.1)] */
    box.dialog-box {
      background-color: rgba(45, 45, 45, 0.90); /* ${tokens.colors.background.secondary.value} */
      border-radius: 12px;
      padding: 16px;
      min-width: 280px;
      border: 1px solid ${tokens.colors.border.hover.value};
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    
    /* Content area spacing */
    box.content-box {
      margin-bottom: 16px;
    }
    
    /* Icon - text-4xl mb-4 */
    label.dialog-icon {
      font-size: 36px;
      margin-bottom: 12px;
    }
    
    /* Title - text-sm font-semibold text-foreground-primary mb-1 */
    label.dialog-title {
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 14px;
      font-weight: 600;
      color: ${tokens.colors.foreground.primary.value};
      margin-bottom: 6px;
    }
    
    /* Message - text-xs text-foreground-tertiary leading-relaxed */
    label.dialog-message {
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 12px;
      font-weight: 400;
      color: ${tokens.colors.foreground.tertiary.value};
      line-height: 1.5;
    }
    
    /* Button base - matches design-system Button component */
    /* h-7 px-3 text-xs (sm size) font-button (SF Pro Rounded) font-medium rounded-md transition-all duration-150 */
    button.dialog-button {
      padding: 4px 12px;
      font-size: 14px;
      font-weight: 700;
      border-radius: 6px;
      min-height: 28px;
      transition: all 150ms ease;
      font-family: "${tokens.typography.fontFamily.button.value}", "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }
    
    button.dialog-button label {
      color: inherit;
    }
    
    /* Cancel button - matches 'default' variant */
    /* bg-background-tertiary text-foreground-primary */
    /* border border-white/10 hover:border-white/20 */
    button.cancel {
      background-color: #373737; /* background-tertiary */
      color: #ffffff; /* foreground-primary */
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    button.cancel:hover {
      background-color: rgba(55, 55, 55, 0.9);
      border-color: rgba(255, 255, 255, 0.2);
    }
    
    button.cancel:focus {
      outline: 2px solid rgba(255, 255, 255, 0.3);
      outline-offset: 2px;
    }
    
    button.cancel:active {
      transform: scale(0.98);
    }
    
    /* Confirm button - matches semantic variants (danger/warning/primary) */
    /* shadow-sm hover:shadow focus-visible:outline-2 */
    button.confirm {
      border: none;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    }
    
    button.confirm:hover {
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    
    button.confirm:active {
      transform: scale(0.98);
    }
  `,
    false,
  );
}

// Apply static CSS on module load
applyStaticCSS();

// Update only variant-specific colors (called only when variant changes)
function updateVariantCSS(variant: "danger" | "warning" | "info" | "suspend") {
  // Skip if variant hasn't changed
  if (currentVariant === variant) return;
  currentVariant = variant;

  const colors = variants[variant];

  app.apply_css(
    `
    label.dialog-icon {
      color: ${colors.iconColor};
    }

    button.confirm {
      background-color: ${colors.confirmBg};
      color: ${colors.confirmTextColor};
    }

    button.confirm:hover {
      background-color: ${colors.confirmHoverBg};
    }

    button.confirm:focus {
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
  // Cancel any pending show timeout
  if (showTimeoutId !== null) {
    GLib.source_remove(showTimeoutId);
    showTimeoutId = null;
  }
}

function showDialog(config: ConfirmConfig) {
  // Ignore if dialog is already visible or pending
  if (isVisible) {
    return;
  }

  // Mark as visible immediately to prevent duplicate calls
  isVisible = true;
  currentConfig = config;

  if (!win) {
    createWindow();
  }

  // Play warning sound if audioFile is provided (using pw-play for faster startup)
  if (config.audioFile) {
    try {
      GLib.spawn_command_line_async(`pw-play ${config.audioFile}`);
    } catch (e) {
      console.error(`Failed to play audio: ${e}`);
    }
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

  // Update CSS for variant colors (only if changed)
  updateVariantCSS(config.variant);

  // Function to show the window
  const showWindow = () => {
    if (win) {
      win.set_visible(true);
      if (cancelButton) cancelButton.grab_focus();
    }
    showTimeoutId = null;
  };

  // Cancel any existing timeout
  if (showTimeoutId !== null) {
    GLib.source_remove(showTimeoutId);
  }

  // Show window with optional delay
  if (config.showDelay && config.showDelay > 0) {
    showTimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      config.showDelay,
      () => {
        showWindow();
        return false; // Don't repeat
      },
    );
  } else {
    showWindow();
  }
}

function createWindow() {
  // Create window with JSX
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
      $={(self: Astal.Window) => {
        // Add escape key handler
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
        {/* Content area */}
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

        {/* Button area */}
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

  // Initialize with default variant colors
  updateVariantCSS(currentConfig.variant);
}

// IPC to receive show/hide commands via AGS messaging
app.start({
  main() {
    createWindow();
    return null;
  },
  instanceName: "confirm-dialog-daemon",
  requestHandler(argv: string[], res: (response: any) => void) {
    try {
      // Join argv into a single string and parse as JSON
      const request = argv.join(" ");
      
      // Handle empty requests (daemon startup without arguments)
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
      console.error("Error handling request:", e);
      res("error: " + e);
    }
  },
});
