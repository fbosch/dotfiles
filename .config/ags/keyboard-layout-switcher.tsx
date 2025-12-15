import { Astal } from "ags/gtk4";
import app from "ags/gtk4/app";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import tokens from "../../design-system/tokens.json";

// Configuration interface
interface LayoutSwitchConfig {
  layouts: string[]; // Array of all available layouts (e.g., ["EN", "DA"])
  activeLayout: string; // Which layout is currently active
  size?: "sm" | "md" | "lg";
}

let win: Astal.Window | null = null;
const layoutLabels: Map<string, Gtk.Label> = new Map();
let isVisible: boolean = false;
let hideTimeoutId: number | null = null;

// Size configurations matching design-system component
const sizes = {
  sm: {
    containerPadding: "4px",
    badgePaddingX: "16px",
    badgePaddingY: "6px",
    fontSize: "14px",
    minWidth: "56px",
    gap: "4px",
  },
  md: {
    containerPadding: "6px",
    badgePaddingX: "20px",
    badgePaddingY: "8px",
    fontSize: "16px",
    minWidth: "64px",
    gap: "6px",
  },
  lg: {
    containerPadding: "8px",
    badgePaddingX: "24px",
    badgePaddingY: "12px",
    fontSize: "18px",
    minWidth: "80px",
    gap: "8px",
  },
};

function updateCSS(size: "sm" | "md" | "lg") {
  const sizeConfig = sizes[size];

  app.apply_css(
    `
    window.keyboard-layout-switcher {
      background-color: transparent;
      border: none;
    }
    
    box.shadow-wrapper {
      padding: 24px;
    }
    
    box.switcher-container {
      background-color: rgba(55, 55, 55, 0.80);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 9999px;
      padding: ${sizeConfig.containerPadding};
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    }
    
    label.layout-badge {
      font-family: "${tokens.typography.fontFamily.button.value}", "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-weight: 700;
      font-size: ${sizeConfig.fontSize};
      padding: ${sizeConfig.badgePaddingY} ${sizeConfig.badgePaddingX};
      min-width: ${sizeConfig.minWidth};
      border-radius: 9999px;
      transition: all 200ms ease;
    }
    
    label.from-badge {
      background-color: transparent;
      color: ${tokens.colors.foreground.tertiary.value};
      border: 1px solid transparent;
    }
    
    label.to-badge {
      background-color: ${tokens.colors.accent.primary.value};
      color: ${tokens.colors.foreground.primary.value};
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }
  `,
    false,
  );
}

function hideSwitcher() {
  if (!isVisible || !win) {
    return;
  }

  // Cancel any pending hide timeout
  if (hideTimeoutId !== null) {
    GLib.source_remove(hideTimeoutId);
    hideTimeoutId = null;
  }

  win.set_visible(false);
  isVisible = false;
}

function showSwitcher(config: LayoutSwitchConfig) {
  // Create window on first call
  if (!win) {
    createWindow(config.layouts, config.size || "sm");
  }

  // Update the active indicator
  updateActiveState(config.activeLayout);
  
  // Show window if not visible
  if (!isVisible) {
    if (win) {
      win.set_visible(true);
    }
    isVisible = true;
  }

  // Cancel existing timer and start new one
  // This resets the countdown on each switch
  if (hideTimeoutId !== null) {
    GLib.source_remove(hideTimeoutId);
    hideTimeoutId = null;
  }

  // Auto-hide after 250ms delay + 300ms display time = 550ms total
  hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 550, () => {
    hideSwitcher();
    return false;
  });
}

function updateActiveState(activeLayout: string) {
  for (const [layoutCode, label] of layoutLabels.entries()) {
    label.remove_css_class("from-badge");
    label.remove_css_class("to-badge");
    
    if (layoutCode === activeLayout) {
      label.add_css_class("to-badge");
    } else {
      label.add_css_class("from-badge");
    }
  }
}

function createWindow(layouts: string[], size: "sm" | "md" | "lg") {
  win = new Astal.Window({
    name: "keyboard-layout-switcher",
    namespace: "ags-layout-switcher",
    visible: false,
  });

  win.set_anchor(Astal.WindowAnchor.NONE);
  win.set_layer(Astal.Layer.OVERLAY);
  win.set_exclusivity(Astal.Exclusivity.NORMAL);
  win.set_keymode(Astal.Keymode.NONE);
  win.add_css_class("keyboard-layout-switcher");

  const shadowWrapper = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER,
  });
  shadowWrapper.add_css_class("shadow-wrapper");

  const switcherContainer = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: Number.parseInt(sizes[size].gap, 10),
  });
  switcherContainer.add_css_class("switcher-container");

  const badgesContainer = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: Number.parseInt(sizes[size].gap, 10),
  });
  badgesContainer.add_css_class("badges-container");

  layoutLabels.clear();
  for (const layoutCode of layouts) {
    const label = new Gtk.Label({
      label: layoutCode,
      halign: Gtk.Align.CENTER,
      valign: Gtk.Align.CENTER,
    });
    label.add_css_class("layout-badge");
    label.add_css_class("from-badge");
    
    layoutLabels.set(layoutCode, label);
    badgesContainer.append(label);
  }

  switcherContainer.append(badgesContainer);
  shadowWrapper.append(switcherContainer);
  win.set_child(shadowWrapper);

  updateCSS(size);
}

// IPC to receive show/hide commands via AGS messaging
app.start({
  main() {
    return null;
  },
  instanceName: "keyboard-layout-switcher-daemon",
  requestHandler(argv: string[], res: (response: string) => void) {
    try {
      const request = argv.join(" ");
      const data = JSON.parse(request);

      if (data.action === "show") {
        showSwitcher(data.config);
        res("shown");
      } else if (data.action === "hide") {
        hideSwitcher();
        res("hidden");
      } else {
        res("unknown action");
      }
    } catch (e) {
      res(`error: ${e}`);
    }
  },
});
