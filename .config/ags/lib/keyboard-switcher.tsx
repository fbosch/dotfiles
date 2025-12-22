import { Astal } from "ags/gtk4";
import app from "ags/gtk4/app";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import tokens from "../../../design-system/tokens.json";

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
let currentSize: "sm" | "md" | "lg" = "sm"; // Track current size to avoid redundant CSS updates
let lastActiveLayout: string | null = null; // Track last active to avoid redundant updates

// Size configurations matching design-system component
interface SizeConfig {
  containerPadding: string;
  badgePaddingX: string;
  badgePaddingY: string;
  fontSize: string;
  minWidth: string;
  gap: string;
}

interface CalculatedDimensions {
  badgeWidth: number;
  badgePaddingX: number;
  badgePaddingY: number;
  gap: number;
  fontSize: number;
  borderWidth: number;
  fullBadgeWidth: number;
  fullBadgeHeight: number;
  pillOffset: number;
  containerPadding: number;
  innerWidth: number;
  containerWidth: number;
}

const sizes: Record<"sm" | "md" | "lg", SizeConfig> = {
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

// Pre-calculate all dimensions for each size on startup
const calculatedSizes: Record<"sm" | "md" | "lg", CalculatedDimensions> = {} as any;

function precalculateDimensions() {
  for (const [sizeName, sizeConfig] of Object.entries(sizes) as [keyof typeof sizes, SizeConfig][]) {
    const badgeWidth = Number.parseInt(sizeConfig.minWidth, 10);
    const badgePaddingX = Number.parseInt(sizeConfig.badgePaddingX, 10);
    const badgePaddingY = Number.parseInt(sizeConfig.badgePaddingY, 10);
    const gap = Number.parseInt(sizeConfig.gap, 10);
    const fontSize = Number.parseInt(sizeConfig.fontSize, 10);
    const borderWidth = 2; // 1px border on each side
    const fullBadgeWidth = badgeWidth + badgePaddingX * 2 + borderWidth;
    const fullBadgeHeight = fontSize + badgePaddingY * 2 + borderWidth;
    const pillOffset = fullBadgeWidth + gap;
    const containerPadding = Number.parseInt(sizeConfig.containerPadding, 10);
    const innerWidth = fullBadgeWidth * 2;
    const containerWidth = innerWidth + containerPadding * 2;

    calculatedSizes[sizeName] = {
      badgeWidth,
      badgePaddingX,
      badgePaddingY,
      gap,
      fontSize,
      borderWidth,
      fullBadgeWidth,
      fullBadgeHeight,
      pillOffset,
      containerPadding,
      innerWidth,
      containerWidth,
    };
  }
}

// Pre-calculate on module load
precalculateDimensions();

// Apply static CSS once on module load
function applyStaticCSS() {
  app.apply_css(
    `
    window.keyboard-layout-switcher {
      background-color: transparent;
      border: none;
    }
    
    window.keyboard-layout-switcher box.shadow-wrapper {
      padding: 24px;
      opacity: 0;
      transition: opacity 100ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    window.keyboard-layout-switcher box.shadow-wrapper.visible {
      opacity: 1;
    }
    
    window.keyboard-layout-switcher box.shadow-wrapper.hiding {
      opacity: 0;
      transition: opacity 50ms cubic-bezier(0.4, 0, 1, 1);
    }
    
    window.keyboard-layout-switcher box.keyboard-switcher-container {
      background-color: rgba(55, 55, 55, 0.80);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 9999px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    }
    
    window.keyboard-layout-switcher box.pill-background {
      background-color: ${tokens.colors.accent.primary.value};
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 9999px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      transform: translateX(0px);
      transition: transform 300ms cubic-bezier(0.4, 0, 0.1, 1);
    }
    
    window.keyboard-layout-switcher box.badges-container {
      margin: 0px;
      padding: 0px;
    }
    
    window.keyboard-layout-switcher label.layout-badge {
      font-family: "${tokens.typography.fontFamily.button.value}", "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-weight: 700;
      border-radius: 9999px;
      color: ${tokens.colors.foreground.tertiary.value};
      background-color: transparent;
      border: 1px solid transparent;
      transition: color 200ms ease;
    }
    
    window.keyboard-layout-switcher label.layout-badge.active {
      color: ${tokens.colors.foreground.primary.value};
    }
  `,
    false,
  );
}

// Apply static CSS on module load
applyStaticCSS();

let dynamicStyleElement: Gtk.CssProvider | null = null;

function updateCSS(size: "sm" | "md" | "lg" = "sm") {
  const sizeConfig = sizes[size];
  const dims = calculatedSizes[size];
  
  // Store globally for animation
  pillOffset = dims.pillOffset;

  // Use inline CSS with custom properties for dynamic sizing
  // This is much faster than regenerating the entire stylesheet
  const dynamicCSS = `
    window.keyboard-layout-switcher box.keyboard-switcher-container {
      padding: ${sizeConfig.containerPadding};
      min-width: ${dims.containerWidth}px;
      #max-width: ${dims.containerWidth}px;
    }
    
    window.keyboard-layout-switcher overlay {
      min-width: ${dims.innerWidth}px;
      #max-width: ${dims.innerWidth}px;
    }
    
    window.keyboard-layout-switcher box.pill-wrapper {
      min-width: ${dims.innerWidth}px;
      #max-width: ${dims.innerWidth}px;
    }
    
    window.keyboard-layout-switcher box.pill-background {
      min-width: ${dims.fullBadgeWidth}px;
      min-height: ${dims.fullBadgeHeight}px;
    }
    
    window.keyboard-layout-switcher box.pill-background.position-1 {
      transform: translateX(${dims.pillOffset}px);
    }
    
    window.keyboard-layout-switcher box.badges-container {
      min-width: ${dims.innerWidth}px;
      #max-width: ${dims.innerWidth}px;
    }
    
    window.keyboard-layout-switcher label.layout-badge {
      font-size: ${sizeConfig.fontSize};
      padding: ${sizeConfig.badgePaddingY} ${sizeConfig.badgePaddingX};
      min-width: ${sizeConfig.minWidth};
    }
  `;

  app.apply_css(dynamicCSS, false);
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

  // Hide window after fade out completes (50ms animation + 10ms buffer)
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
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
  const size = config.size || "sm";
  
  // Check if we need to recreate window (layouts changed or doesn't exist)
  const layoutsChanged = win !== null && 
    (currentLayouts.length !== config.layouts.length || 
     !currentLayouts.every((l, i) => l === config.layouts[i]));
  
  if (layoutsChanged) {
    // Layouts changed, need to recreate window
    if (win) {
      win.destroy();
      win = null;
    }
    layoutLabels.clear();
    pill = null;
    shadowWrapper = null;
    lastActiveLayout = null;
  }
  
  // Track if window is being created for the first time
  const isFirstCreation = !win;
  
  // Create window on first call or after recreation
  if (isFirstCreation) {
    createWindow(config.layouts, size);
  } else if (size !== currentSize) {
    // Size changed but layouts same - just update CSS
    currentSize = size;
    updateCSS(size);
  }

  // Update the active indicator
  updateActiveState(config.activeLayout);

  // Show window if not visible
  if (!isVisible) {
    // If window was just created, defer showing by one frame
    // to allow GTK to process CSS and layout
    if (isFirstCreation) {
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        if (win) {
          win.set_visible(true);
        }
        isVisible = true;

        // Trigger fade in animation
        if (shadowWrapper) {
          shadowWrapper.remove_css_class("hiding");
          GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            shadowWrapper?.add_css_class("visible");
            return false;
          });
        }
        return false;
      });
    } else {
      // Window already existed, show immediately
      if (win) {
        win.set_visible(true);
      }
      isVisible = true;

      // Trigger fade in animation
      if (shadowWrapper) {
        shadowWrapper.remove_css_class("hiding");
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          shadowWrapper?.add_css_class("visible");
          return false;
        });
      }
    }
  }

  // Reset auto-hide timer (cancel existing and start new one)
  // This resets the countdown on each switch
  if (hideTimeoutId !== null) {
    GLib.source_remove(hideTimeoutId);
  }

  // Auto-hide after 550ms display time + 150ms fade in = 700ms total
  hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
    hideSwitcher();
    hideTimeoutId = null;
    return false;
  });
}

function updateActiveState(activeLayout: string) {
  if (!pill) return;
  
  // Skip update if layout hasn't changed
  if (lastActiveLayout === activeLayout) return;
  lastActiveLayout = activeLayout;

  // Find the index of the active layout
  const activeIndex = currentLayouts.indexOf(activeLayout);
  if (activeIndex === -1) return;

  // Update pill position with CSS class (only remove old, add new)
  const oldPosition = pill.get_css_classes().find(c => c.startsWith("position-"));
  if (oldPosition) {
    pill.remove_css_class(oldPosition);
  }
  pill.add_css_class(`position-${activeIndex}`);

  // Update label colors - only change the ones that need changing
  for (const [layoutCode, label] of layoutLabels.entries()) {
    const shouldBeActive = layoutCode === activeLayout;
    const isActive = label.has_css_class("active");
    
    if (shouldBeActive && !isActive) {
      label.add_css_class("active");
    } else if (!shouldBeActive && isActive) {
      label.remove_css_class("active");
    }
  }
}

function createWindow(layouts: string[], size: "sm" | "md" | "lg") {
  currentLayouts = layouts;
  currentSize = size;

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
  switcherContainer.add_css_class("keyboard-switcher-container");

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
  const dims = calculatedSizes[size];
  const badgesContainer = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: dims.gap,
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

// Functions for bundled mode (using global namespace pattern)
function initKeyboardSwitcher() {
  precalculateDimensions();
  applyStaticCSS();
  // Pre-initialize with default 2-layout configuration
  createWindow(["", ""], "sm");
}

function handleKeyboardSwitcherRequest(argv: string[], res: (response: string) => void) {
  try {
    const request = argv.join(" ");
    const data = JSON.parse(request);

    if (data.action === "show") {
      showSwitcher(data.config);
      res("shown");
    } else if (data.action === "hide") {
      hideSwitcher();
      res("hidden");
    } else if (data.action === "get-visibility") {
      res(isVisible ? "visible" : "hidden");
    } else {
      res("unknown action");
    }
  } catch (e) {
    console.error("Error handling keyboard-switcher request:", e);
    res(`error: ${e}`);
  }
}

// Make component available globally
globalThis.KeyboardSwitcher = {
  init: initKeyboardSwitcher,
  handleRequest: handleKeyboardSwitcherRequest,
  instanceName: "keyboard-switcher"
};
