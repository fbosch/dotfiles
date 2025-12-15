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
let pill: Gtk.Box | null = null;
let shadowWrapper: Gtk.Box | null = null;
let currentLayouts: string[] = [];
let isVisible: boolean = false;
let hideTimeoutId: number | null = null;
let pillOffset: number = 0; // Store the calculated offset for animation

// Size configurations matching design-system component
const sizes = {
  sm: {
    containerPadding: "4px",
    badgePaddingX: "8px",
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

function updateCSS(size: "sm" | "md" | "lg" = "sm") {
  const sizeConfig = sizes[size];

  // Calculate dimensions for pill positioning
  const badgeWidth = Number.parseInt(sizeConfig.minWidth, 10);
  const badgePaddingX = Number.parseInt(sizeConfig.badgePaddingX, 10);
  const badgePaddingY = Number.parseInt(sizeConfig.badgePaddingY, 10);
  const gap = Number.parseInt(sizeConfig.gap, 10);
  const fontSize = Number.parseInt(sizeConfig.fontSize, 10);
  const borderWidth = 2; // 1px border on each side
  const fullBadgeWidth = badgeWidth + badgePaddingX * 2 + borderWidth;
  const fullBadgeHeight = fontSize + badgePaddingY * 2 + borderWidth;

  // Store globally for animation
  pillOffset = fullBadgeWidth + gap;

  // Container should fit both badges plus gap
  const containerPadding = Number.parseInt(sizeConfig.containerPadding, 10);
  const innerWidth = fullBadgeWidth * 2;
  const containerWidth = innerWidth + containerPadding * 2;

  app.apply_css(
    `
    window.keyboard-layout-switcher {
      background-color: transparent;
      border: none;
    }
    
    box.shadow-wrapper {
      padding: 24px;
      opacity: 0;
      transition: opacity 100ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    box.shadow-wrapper.visible {
      opacity: 1;
    }
    
    box.shadow-wrapper.hiding {
      opacity: 0;
      transition: opacity 50ms cubic-bezier(0.4, 0, 1, 1);
    }
    
    box.switcher-container {
      background-color: rgba(55, 55, 55, 0.80);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 9999px;
      padding: ${sizeConfig.containerPadding};
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      min-width: ${containerWidth}px;
      max-width: ${containerWidth}px;
    }
    
    overlay {
      min-width: ${innerWidth}px;
      max-width: ${innerWidth}px;
    }
    
    box.pill-wrapper {
      /* Must be wide enough to contain pill in both positions */
      min-width: ${innerWidth}px;
      max-width: ${innerWidth}px;
    }
    
    box.pill-background {
      background-color: ${tokens.colors.accent.primary.value};
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 9999px;
      min-width: ${fullBadgeWidth}px;
      min-height: ${fullBadgeHeight}px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      transform: translateX(0px);
      transition: transform 300ms cubic-bezier(0.4, 0, 0.1, 1);
    }
    
    box.pill-background.position-1 {
      transform: translateX(${pillOffset}px);
    }
    
    box.badges-container {
      margin: 0px;
      padding: 0px;
      min-width: ${innerWidth}px;
      max-width: ${innerWidth}px;
    }
    
    label.layout-badge {
      font-family: "${tokens.typography.fontFamily.button.value}", "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-weight: 700;
      font-size: ${sizeConfig.fontSize};
      padding: ${sizeConfig.badgePaddingY} ${sizeConfig.badgePaddingX};
      min-width: ${sizeConfig.minWidth};
      border-radius: 9999px;
      color: ${tokens.colors.foreground.tertiary.value};
      background-color: transparent;
      border: 1px solid transparent;
      transition: color 200ms ease;
    }
    
    label.layout-badge.active {
      color: ${tokens.colors.foreground.primary.value};
    }
  `,
    false,
  );
}

function hideSwitcher() {
  if (!isVisible || !win || !shadowWrapper) {
    return;
  }

  // Cancel any pending hide timeout
  if (hideTimeoutId !== null) {
    GLib.source_remove(hideTimeoutId);
    hideTimeoutId = null;
  }

  // Start fade out animation
  shadowWrapper.remove_css_class("visible");
  shadowWrapper.add_css_class("hiding");

  // Hide window after fade out completes
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
    if (win) {
      win.set_visible(false);
    }
    isVisible = false;
    if (shadowWrapper) {
      shadowWrapper.remove_css_class("hiding");
    }
    return false;
  });
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

    // Trigger fade in animation
    if (shadowWrapper) {
      shadowWrapper.remove_css_class("hiding");
      // Use timeout to ensure class is applied after visibility change
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
        shadowWrapper?.add_css_class("visible");
        return false;
      });
    }
  }

  // Cancel existing timer and start new one
  // This resets the countdown on each switch
  if (hideTimeoutId !== null) {
    GLib.source_remove(hideTimeoutId);
    hideTimeoutId = null;
  }

  // Auto-hide after 550ms display time + 150ms fade in = 700ms total
  hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
    hideSwitcher();
    return false;
  });
}

function updateActiveState(activeLayout: string) {
  if (!pill) return;

  // Find the index of the active layout
  const activeIndex = currentLayouts.indexOf(activeLayout);
  if (activeIndex === -1) return;

  // Update pill position with CSS class
  pill.remove_css_class("position-0");
  pill.remove_css_class("position-1");
  pill.add_css_class(`position-${activeIndex}`);

  // Update label colors
  for (const [layoutCode, label] of layoutLabels.entries()) {
    label.remove_css_class("active");
    if (layoutCode === activeLayout) {
      label.add_css_class("active");
    }
  }
}

function createWindow(layouts: string[], size: "sm" | "md" | "lg") {
  currentLayouts = layouts;

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

  shadowWrapper = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER,
  });
  shadowWrapper.add_css_class("shadow-wrapper");

  const switcherContainer = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    hexpand: false,
  });
  switcherContainer.add_css_class("switcher-container");

  // Create overlay to layer pill behind badges
  const overlay = new Gtk.Overlay();

  // Create a fixed-width wrapper for the pill to prevent it from affecting overlay size
  const pillWrapper = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    halign: Gtk.Align.START,
  });
  pillWrapper.add_css_class("pill-wrapper");

  // Create the animated pill (background indicator)
  pill = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
  });
  pill.add_css_class("pill-background");

  pillWrapper.append(pill);

  // Create badges container
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

    layoutLabels.set(layoutCode, label);
    badgesContainer.append(label);
  }

  // Layer structure: pill wrapper at bottom, badges on top
  overlay.set_child(pillWrapper);
  overlay.add_overlay(badgesContainer);

  switcherContainer.append(overlay);
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
