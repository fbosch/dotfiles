import app from "ags/gtk4/app";
import { Astal } from "ags/gtk4";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import Gdk from "gi://Gdk?version=4.0";
import tokens from "../../design-system/tokens.json";

// Configuration
const ENABLE_ANIMATIONS = false; // Set to false for better performance on slower systems

// Menu item interface - matching design system
interface MenuItem {
  id: string;
  label: string;
  icon: string;
  variant?: "default" | "warning" | "danger" | "suspend";
}

// Flake update data interface
interface FlakeUpdate {
  name: string;
  currentRev: string;
  currentShort: string;
  newRev: string;
  newShort: string;
}

interface FlakeUpdatesData {
  count: number;
  updates: FlakeUpdate[];
  timestamp: string;
}

// Flatpak update data interface
interface FlatpakUpdate {
  name: string;
  appId: string;
  currentVersion: string;
  newVersion: string;
}

interface FlatpakUpdatesData {
  count: number;
  updates: FlatpakUpdate[];
  timestamp: string;
}

// Default menu items - matching design system
const defaultMenuItems: MenuItem[] = [
  {
    id: "system-settings",
    label: "System Settings",
    icon: "\uE713", // Setting
    variant: "default",
  },
  {
    id: "lock-screen",
    label: "Lock Screen",
    icon: "\uE72E", // Lock
    variant: "default",
  },
  { id: "divider-1", label: "", icon: "", variant: "default" },
  {
    id: "applications",
    label: "Applications",
    icon: "\uE71D", // AllApps
    variant: "default",
  },
  {
    id: "documents",
    label: "Documents",
    icon: "\uE8A5", // Document
    variant: "default",
  },
  {
    id: "pictures",
    label: "Pictures",
    icon: "\uE91B", // Pictures
    variant: "default",
  },
  {
    id: "downloads",
    label: "Downloads",
    icon: "\uE896", // Download
    variant: "default",
  },
  { id: "divider-2", label: "", icon: "", variant: "default" },
  {
    id: "suspend",
    label: "Suspend",
    icon: "\uE708", // QuietHours
    variant: "suspend",
  },
  {
    id: "restart",
    label: "Restart",
    icon: "\uE777", // UpdateRestore
    variant: "warning",
  },
  {
    id: "shutdown",
    label: "Shutdown",
    icon: "\uE7E8", // PowerButton
    variant: "danger",
  },
];

// Current state
let win: Astal.Window | null = null;
let menuBox: Gtk.Box | null = null;
let isVisible: boolean = false;
let flakeUpdatesCount: number = 0;
let flakeUpdatesData: FlakeUpdatesData | null = null;
let flatpakUpdatesCount: number = 0;
let flatpakUpdatesData: FlatpakUpdatesData | null = null;
const currentMenuItems: MenuItem[] = defaultMenuItems;
const menuItemButtons: Map<string, Gtk.Button> = new Map();
let flakeUpdateBadgeButton: Gtk.Button | null = null;
let flatpakUpdateBadgeButton: Gtk.Button | null = null;

// Function to read flake updates from cache file
function readFlakeUpdatesCache(): FlakeUpdatesData | null {
  try {
    const cacheDir = GLib.get_user_cache_dir();
    const cachePath = `${cacheDir}/flake-updates.json`;

    if (!GLib.file_test(cachePath, GLib.FileTest.EXISTS)) {
      return null;
    }

    const [success, contents] = GLib.file_get_contents(cachePath);
    if (!success || !contents) {
      return null;
    }

    const decoder = new TextDecoder("utf-8");
    const jsonStr = decoder.decode(contents);
    return JSON.parse(jsonStr) as FlakeUpdatesData;
  } catch (e) {
    console.error("Error reading flake updates cache:", e);
    return null;
  }
}

// Function to read flatpak updates from cache file
function readFlatpakUpdatesCache(): FlatpakUpdatesData | null {
  try {
    const cacheDir = GLib.get_user_cache_dir();
    const cachePath = `${cacheDir}/flatpak-updates.json`;

    if (!GLib.file_test(cachePath, GLib.FileTest.EXISTS)) {
      return null;
    }

    const [success, contents] = GLib.file_get_contents(cachePath);
    if (!success || !contents) {
      return null;
    }

    const decoder = new TextDecoder("utf-8");
    const jsonStr = decoder.decode(contents);
    return JSON.parse(jsonStr) as FlatpakUpdatesData;
  } catch (e) {
    console.error("Error reading flatpak updates cache:", e);
    return null;
  }
}

// Format time difference for tooltip
function formatTimeSince(timestamp: string): string {
  try {
    const then = new Date(timestamp).getTime();
    const now = Date.now();
    const diffMs = now - then;

    const minutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      const remainingHours = hours % 24;
      if (remainingHours > 0) {
        return `${days} day${days !== 1 ? "s" : ""} and ${remainingHours} hour${remainingHours !== 1 ? "s" : ""} ago`;
      }
      return `${days} day${days !== 1 ? "s" : ""} ago`;
    } else if (hours > 0) {
      const remainingMinutes = minutes % 60;
      if (remainingMinutes > 0) {
        return `${hours} hour${hours !== 1 ? "s" : ""} and ${remainingMinutes} minute${remainingMinutes !== 1 ? "s" : ""} ago`;
      }
      return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
    } else if (minutes > 0) {
      return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
    } else {
      return "just now";
    }
  } catch (e) {
    console.error("Error formatting timestamp:", e);
    return "";
  }
}

// Menu item commands - matching design system actions
// Cache terminal lookup for performance
let cachedTerminal: string | null = null;
const getTerminal = (): string => {
  if (cachedTerminal) return cachedTerminal;

  // Check for preferred terminal in order: TERMINAL env var, then fallback to common terminals
  const terminal = GLib.getenv("TERMINAL");
  if (terminal) {
    cachedTerminal = terminal;
    return terminal;
  }

  // Check for common terminals
  const terminals = ["foot", "kitty", "wezterm", "alacritty", "gnome-terminal"];
  for (const term of terminals) {
    if (GLib.find_program_in_path(term)) {
      cachedTerminal = term;
      return term;
    }
  }

  cachedTerminal = "xterm"; // Ultimate fallback
  return cachedTerminal;
};

// Cache home directory for performance
const homeDir = GLib.get_home_dir();

// Build terminal command with correct flags based on terminal
const getSystemUpdatesCommand = (): string => {
  const terminal = getTerminal();

  // flake_update_interactive is a Fish function, so we need to invoke it through Fish
  // Add --rebuild flag to prompt for system rebuild after updates
  // Add --cache flag to use cached update data (instant startup)
  // Add --header flag to show decorative ASCII header with flake info
  // IMPORTANT: Put the entire Fish command in quotes so flags are passed to the function
  const fishCommand =
    'fish -c "flake_update_interactive --rebuild --cache --header"';

  // Different terminals use different flags for setting window class/app-id
  switch (terminal) {
    case "foot":
      return `${terminal} --app-id=flake_update_terminal ${fishCommand}`;
    case "kitty":
      return `${terminal} --class flake_update_terminal -e ${fishCommand}`;
    case "alacritty":
      return `${terminal} --class flake_update_terminal -e ${fishCommand}`;
    case "wezterm":
      // WezTerm doesn't support --class flag, use start subcommand
      return `${terminal} start ${fishCommand}`;
    case "gnome-terminal":
      return `${terminal} -- ${fishCommand}`;
    default:
      // Fallback for xterm and others
      return `${terminal} -e ${fishCommand}`;
  }
};

const menuCommands: Record<string, string> = {
  "system-settings": "gnome-tweaks",
  "lock-screen": "hyprlock",
  applications: "io.github.flattool.Warehouse",
  documents: "nemo --existing-window /mnt/nas/FrederikDocs",
  pictures: `nemo --existing-window ${homeDir}/Pictures`,
  downloads: `nemo --existing-window ${homeDir}/Downloads`,
  suspend: `${homeDir}/.config/hypr/scripts/confirm-suspend.sh`,
  restart: `${homeDir}/.config/hypr/scripts/confirm-restart.sh`,
  shutdown: `${homeDir}/.config/hypr/scripts/confirm-shutdown.sh`,
  "nixos-updates": getSystemUpdatesCommand(),
  "flatpak-updates": getSystemUpdatesCommand(), // Both updated during NixOS rebuild
};

// Apply static CSS once on module load
function applyStaticCSS() {
  const transitionStyle = ENABLE_ANIMATIONS
    ? "transition: all 150ms ease;"
    : "";

  app.apply_css(
    `
    /* Window container - fullscreen transparent to capture clicks */
    window.start-menu {
      background-color: transparent;
      border: none;
      padding: 0;
    }

    /* Menu container - matches design-system StartMenu component */
    /* bg-background-secondary/90 border border-white/15 backdrop-blur-sm shadow rounded-lg p-1 w-52 */
    box.start-menu-container {
      background-color: rgba(45, 45, 45, 0.90);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      padding: 5px; /* Better internal spacing */
      min-width: 208px; /* w-52 = 13rem = 208px */
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    /* Menu item base - matches design-system menuItemVariants */
    /* w-full flex items-center gap-2 px-2 py-1 text-sm rounded-md transition-colors duration-150 */
    button.menu-item {
      padding: 2px 6px; /* More compact: reduced from 4px 8px */
      font-size: 14px;
      border-radius: 6px;
      min-height: 24px; /* More compact: reduced from 28px */
      ${transitionStyle}
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      border: none;
      background-color: transparent;
    }

    button.menu-item:hover {
      background-color: rgba(255, 255, 255, 0.1);
    }

    button.menu-item:focus {
      outline: 2px solid rgba(255, 255, 255, 0.3);
      outline-offset: 2px;
    }

    button.menu-item:active {
      transform: scale(0.98);
    }

    /* Variant-specific styles - applied statically for performance */
    button.menu-variant-default {
      color: ${tokens.colors.foreground.primary.value};
    }
    button.menu-variant-default:hover {
      background-color: #ffffff1a;
    }
    button.menu-variant-default:focus {
      background-color: #ffffff1a;
    }

    button.menu-variant-warning {
      color: ${tokens.colors.state.warning.value};
    }
    button.menu-variant-warning:hover {
      background-color: ${tokens.colors.state.warning.value}1a;
    }
    button.menu-variant-warning:focus {
      background-color: ${tokens.colors.state.warning.value}1a;
    }

    button.menu-variant-danger {
      color: ${tokens.colors.state.error.value};
    }
    button.menu-variant-danger:hover {
      background-color: ${tokens.colors.state.error.value}1a;
    }
    button.menu-variant-danger:focus {
      background-color: ${tokens.colors.state.error.value}1a;
    }

    button.menu-variant-suspend {
      color: ${tokens.colors.state.purple.value};
    }
    button.menu-variant-suspend:hover {
      background-color: ${tokens.colors.state.purple.value}1a;
    }
    button.menu-variant-suspend:focus {
      background-color: ${tokens.colors.state.purple.value}1a;
    }

    /* Menu item label layout */
    box.menu-item-content {
      /* spacing handled by GTK widget properties */
    }

    /* Icon styling */
    label.menu-item-icon {
      font-family: "Segoe Fluent Icons", "Segoe UI Symbol", sans-serif;
      font-size: 14px;
      min-width: 14px;
      max-width: 14px;
      min-height: 14px;
      max-height: 14px;
      text-align: center;
    }

    /* Text styling */
    label.menu-item-label {
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 14px;
      font-weight: 400;
    }

    /* Divider */
    separator.menu-divider {
      margin: 4px 0;
      background-color: rgba(255, 255, 255, 0.1);
      min-height: 1px;
    }

    /* System updates badge button */
    button.system-updates-badge {
      padding: 2px 6px;
      font-size: 14px;
      border-radius: 6px;
      min-height: 24px;
      ${transitionStyle}
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      border: none;
      background-color: transparent;
    }

    button.system-updates-badge:hover {
      background-color: rgba(255, 255, 255, 0.1);
    }

    button.system-updates-badge:focus {
      outline: 2px solid rgba(255, 255, 255, 0.3);
      outline-offset: 2px;
    }

    /* Badge content layout */
    box.system-updates-content {
      /* spacing handled by GTK widget properties */
    }

    /* Updates badge - matches design-system Tag component primary variant */
    box.updates-badge {
      background-color: ${tokens.colors.accent.primary.value};
      color: #ffffff;
      padding: 2px 4px;
      font-weight: 600;
      border-radius: 12px; /* fully rounded pill shape */
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    }

    box.updates-badge label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.5px;
      color: #ffffff;
    }
  `,
    false,
  );
}

// Apply static CSS on module load
applyStaticCSS();

function hideMenu() {
  if (win) {
    win.set_visible(false);
    isVisible = false;
    // Clear any focused elements
    const focused = win.get_focus();
    if (focused) {
      win.set_focus(null);
    }
  }
}

function showMenu(updatesCount?: number) {
  // Read updates from both caches
  const flakeCacheData = readFlakeUpdatesCache();
  const flatpakCacheData = readFlatpakUpdatesCache();

  let needsUpdate = false;

  if (flakeCacheData) {
    const oldCount = flakeUpdatesCount;
    flakeUpdatesCount = flakeCacheData.count;
    flakeUpdatesData = flakeCacheData;
    if (oldCount !== flakeUpdatesCount) {
      needsUpdate = true;
    }
  }

  if (flatpakCacheData) {
    const oldCount = flatpakUpdatesCount;
    flatpakUpdatesCount = flatpakCacheData.count;
    flatpakUpdatesData = flatpakCacheData;
    if (oldCount !== flatpakUpdatesCount) {
      needsUpdate = true;
    }
  }

  if (needsUpdate) {
    updateMenuItems();
  }

  if (win) {
    win.set_visible(true);
    isVisible = true;
    // Clear any existing focus to ensure clean state
    const currentFocus = win.get_focus();
    if (currentFocus) {
      win.set_focus(null);
    }
    // Also remove focus styling from all buttons
    for (const button of menuItemButtons.values()) {
      button.remove_css_class("focused");
      // Force style update
      button.get_style_context().remove_class("focused");
    }
    // Ensure Waybar stays visible while menu is open
    try {
      GLib.spawn_command_line_async("pkill -SIGUSR1 waybar");
    } catch (e) {
      console.error("Failed to show waybar:", e);
    }
  }
}

function executeMenuCommand(itemId: string) {
  const command = menuCommands[itemId];
  console.log(`Executing command for ${itemId}:`, command);
  if (command) {
    try {
      // Use sh -c to properly handle complex commands with pipes and arguments
      GLib.spawn_command_line_async(`sh -c '${command}'`);
      console.log(`Successfully spawned command for ${itemId}`);
    } catch (e) {
      console.error(`Failed to execute command for ${itemId}:`, e);
    }
  } else {
    console.error(`No command found for ${itemId}`);
  }
  hideMenu();
}

function updateMenuItems() {
  if (!menuBox) return;

  // Type assertion to help TypeScript understand menuBox is non-null after guard
  const box = menuBox as Gtk.Box;

  // Clear existing items
  let child = box.get_first_child();
  while (child) {
    box.remove(child);
    child = box.get_first_child();
  }

  // Clear button references
  menuItemButtons.clear();
  flakeUpdateBadgeButton = null;
  flatpakUpdateBadgeButton = null;

  // Add menu items
  currentMenuItems.forEach((item) => {
    if (item.id.startsWith("divider")) {
      // Add divider
      const separator = new Gtk.Separator({
        orientation: Gtk.Orientation.HORIZONTAL,
      });
      separator.add_css_class("menu-divider");
      box.append(separator);
    } else {
      // Add menu item button
      const button = new Gtk.Button({ can_focus: true });
      button.add_css_class("menu-item");
      button.set_cursor_from_name("pointer");

      // Create content box
      const contentBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8,
        halign: Gtk.Align.START,
      });
      contentBox.add_css_class("menu-item-content");

      // Add icon
      const iconLabel = new Gtk.Label({ label: item.icon });
      iconLabel.add_css_class("menu-item-icon");
      contentBox.append(iconLabel);

      // Add text
      const textLabel = new Gtk.Label({
        label: item.label,
        halign: Gtk.Align.START,
      });
      textLabel.add_css_class("menu-item-label");

      // Apply variant colors via CSS class only (CSS is static)
      button.add_css_class(`menu-variant-${item.variant || "default"}`);

      contentBox.append(textLabel);

      button.set_child(contentBox);

      // Connect click handler
      button.connect("clicked", () => {
        executeMenuCommand(item.id);
      });

      box.append(button);
      menuItemButtons.set(item.id, button);

      // Add NixOS flake updates badge if applicable
      if (item.id === "system-settings" && flakeUpdatesCount > 0) {
        const badgeButton = new Gtk.Button();
        badgeButton.add_css_class("system-updates-badge");
        badgeButton.set_cursor_from_name("pointer");

        const badgeContent = new Gtk.Box({
          orientation: Gtk.Orientation.HORIZONTAL,
          spacing: 8,
          halign: Gtk.Align.FILL,
        });
        badgeContent.add_css_class("system-updates-content");

        // Icon
        const badgeIcon = new Gtk.Label({ label: "\uE895" }); // Download icon
        badgeIcon.add_css_class("menu-item-icon");
        badgeContent.append(badgeIcon);

        // Text
        const badgeText = new Gtk.Label({
          label: "Updates",
          halign: Gtk.Align.START,
          hexpand: true,
        });
        badgeText.add_css_class("menu-item-label");
        badgeContent.append(badgeText);

        // Badge count with snowflake icon - wrapped in a box for padding support
        const badgeBox = new Gtk.Box({
          orientation: Gtk.Orientation.HORIZONTAL,
          halign: Gtk.Align.END,
          valign: Gtk.Align.CENTER,
        });
        badgeBox.add_css_class("updates-badge");

        const badge = new Gtk.Label({
          label: `  ${flakeUpdatesCount.toString()}`,
          halign: Gtk.Align.CENTER,
          valign: Gtk.Align.CENTER,
        });

        badgeBox.append(badge);
        badgeContent.append(badgeBox);

        badgeButton.set_child(badgeContent);

        // Add tooltip with update details if available
        if (flakeUpdatesData && flakeUpdatesData.updates.length > 0) {
          const tooltipText = flakeUpdatesData.updates
            .map((u) => `• ${u.name}: ${u.currentShort} → ${u.newShort}`)
            .join("\n");
          const timeAgo = formatTimeSince(flakeUpdatesData.timestamp);
          const lastCheckedText = timeAgo ? `\n\nLast checked: ${timeAgo}` : "";
          badgeButton.set_tooltip_text(
            `${flakeUpdatesCount} update${flakeUpdatesCount !== 1 ? "s" : ""} available:\n${tooltipText}${lastCheckedText}`,
          );
        } else {
          badgeButton.set_tooltip_text(
            `${flakeUpdatesCount} update${flakeUpdatesCount !== 1 ? "s" : ""} available`,
          );
        }

        badgeButton.connect("clicked", () =>
          executeMenuCommand("nixos-updates"),
        );

        box.append(badgeButton);
        flakeUpdateBadgeButton = badgeButton;
        menuItemButtons.set("nixos-updates", badgeButton);
      }

      // Add Flatpak updates badge if applicable
      if (item.id === "system-settings" && flatpakUpdatesCount > 0) {
        const badgeButton = new Gtk.Button();
        badgeButton.add_css_class("system-updates-badge");
        badgeButton.set_cursor_from_name("pointer");

        const badgeContent = new Gtk.Box({
          orientation: Gtk.Orientation.HORIZONTAL,
          spacing: 8,
          halign: Gtk.Align.FILL,
        });
        badgeContent.add_css_class("system-updates-content");

        // Icon
        const badgeIcon = new Gtk.Label({ label: "\uF187" }); // Package icon
        badgeIcon.add_css_class("menu-item-icon");
        badgeContent.append(badgeIcon);

        // Text
        const badgeText = new Gtk.Label({
          label: "Flatpak Updates",
          halign: Gtk.Align.START,
          hexpand: true,
        });
        badgeText.add_css_class("menu-item-label");
        badgeContent.append(badgeText);

        // Badge count - wrapped in a box for padding support
        const badgeBox = new Gtk.Box({
          orientation: Gtk.Orientation.HORIZONTAL,
          halign: Gtk.Align.END,
          valign: Gtk.Align.CENTER,
        });
        badgeBox.add_css_class("updates-badge");

        const badge = new Gtk.Label({
          label: ` ${flatpakUpdatesCount.toString()}`,
          halign: Gtk.Align.CENTER,
          valign: Gtk.Align.CENTER,
        });

        badgeBox.append(badge);
        badgeContent.append(badgeBox);

        badgeButton.set_child(badgeContent);

        // Add tooltip with update details if available
        if (flatpakUpdatesData && flatpakUpdatesData.updates.length > 0) {
          const tooltipText = flatpakUpdatesData.updates
            .map((u) => `• ${u.name}: ${u.currentVersion} → ${u.newVersion}`)
            .join("\n");
          const timeAgo = formatTimeSince(flatpakUpdatesData.timestamp);
          const lastCheckedText = timeAgo ? `\n\nLast checked: ${timeAgo}` : "";
          badgeButton.set_tooltip_text(
            `${flatpakUpdatesCount} Flatpak update${flatpakUpdatesCount !== 1 ? "s" : ""} available:\n${tooltipText}${lastCheckedText}`,
          );
        } else {
          badgeButton.set_tooltip_text(
            `${flatpakUpdatesCount} Flatpak update${flatpakUpdatesCount !== 1 ? "s" : ""} available`,
          );
        }

        badgeButton.connect("clicked", () =>
          executeMenuCommand("flatpak-updates"),
        );

        box.append(badgeButton);
        flatpakUpdateBadgeButton = badgeButton;
        menuItemButtons.set("flatpak-updates", badgeButton);
      }
    }
  });
}

function createWindow() {
  win = new Astal.Window({
    name: "start-menu",
    namespace: "ags-start-menu",
    visible: false,
  });

  // Configure window properties - fullscreen transparent to capture all clicks
  win.set_anchor(
    Astal.WindowAnchor.TOP |
      Astal.WindowAnchor.BOTTOM |
      Astal.WindowAnchor.LEFT |
      Astal.WindowAnchor.RIGHT,
  );
  win.set_layer(Astal.Layer.OVERLAY);
  win.set_exclusivity(Astal.Exclusivity.IGNORE);
  win.set_keymode(Astal.Keymode.ON_DEMAND);
  win.add_css_class("start-menu");

  // Add escape key handler and keyboard navigation
  const keyController = new Gtk.EventControllerKey();
  keyController.connect(
    "key-pressed",
    (_: Gtk.EventControllerKey, keyval: number) => {
      if (keyval === Gdk.KEY_Escape) {
        hideMenu();
        return true;
      }

      // Keyboard navigation
      const focusableButtons = Array.from(menuItemButtons.values()).filter(
        (btn) => btn.can_focus,
      );

      if (focusableButtons.length === 0) return false;

      let currentFocus = focusableButtons.find((btn) => btn.has_focus);
      let currentIndex = currentFocus
        ? focusableButtons.indexOf(currentFocus)
        : -1;

      if (keyval === Gdk.KEY_Tab || keyval === Gdk.KEY_Down) {
        // Move to next item
        const nextIndex = (currentIndex + 1) % focusableButtons.length;
        focusableButtons[nextIndex].grab_focus();
        return true;
      } else if (keyval === Gdk.KEY_ISO_Left_Tab || keyval === Gdk.KEY_Up) {
        // Move to previous item (Shift+Tab or Up arrow)
        const prevIndex =
          currentIndex <= 0 ? focusableButtons.length - 1 : currentIndex - 1;
        focusableButtons[prevIndex].grab_focus();
        return true;
      } else if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_space) {
        // Activate current item
        if (currentFocus) {
          currentFocus.activate();
          return true;
        }
      }

      return false;
    },
  );
  win.add_controller(keyController);

  // Add click-anywhere handler - close menu on any click when visible
  // Use 'released' instead of 'pressed' to let button clicks process first
  const clickController = new Gtk.GestureClick();
  clickController.connect("released", (_controller, _n_press, x, y) => {
    if (!isVisible) return;

    // Check if click is outside the menu container
    if (menuBox) {
      const allocation = menuBox.get_allocation();
      const menuX = allocation.x;
      const menuY = allocation.y;
      const menuWidth = allocation.width;
      const menuHeight = allocation.height;

      // If click is outside menu bounds, close menu
      if (
        x < menuX ||
        x > menuX + menuWidth ||
        y < menuY ||
        y > menuY + menuHeight
      ) {
        hideMenu();
      }
    }
  });
  win.add_controller(clickController);

  // Create outer container for positioning
  const outerBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    valign: Gtk.Align.END,
    halign: Gtk.Align.START,
  });

  // Create menu container
  menuBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 0,
  });
  menuBox.add_css_class("start-menu-container");

  // Initialize menu items
  updateMenuItems();

  outerBox.append(menuBox);
  win.set_child(outerBox);

  // Position menu above Waybar with margin
  app.apply_css(
    `
    box.start-menu-container {
      margin-bottom: 53px; /* Waybar height (45px) + gap (8px) */
      margin-left: 8px;
    }
  `,
    false,
  );
}

// IPC to receive show/hide commands via AGS messaging
app.start({
  main() {
    // Load cache data on startup for instant display
    const flakeCacheData = readFlakeUpdatesCache();
    if (flakeCacheData) {
      flakeUpdatesCount = flakeCacheData.count;
      flakeUpdatesData = flakeCacheData;
    }

    const flatpakCacheData = readFlatpakUpdatesCache();
    if (flatpakCacheData) {
      flatpakUpdatesCount = flatpakCacheData.count;
      flatpakUpdatesData = flatpakCacheData;
    }

    // Create window immediately for responsiveness
    createWindow();
    return null;
  },
  instanceName: "start-menu-daemon",
  requestHandler(argv: string[], res: (response: string) => void) {
    try {
      const request = argv.join(" ");

      // Handle empty requests (daemon startup without arguments)
      if (!request || request.trim() === "") {
        res("ready");
        return;
      }

      const data = JSON.parse(request);

      if (data.action === "show") {
        try {
          showMenu(data.systemUpdatesCount);
          res("shown");
        } catch (e) {
          console.error("Error in showMenu:", e);
          res("error: show failed");
        }
      } else if (data.action === "toggle") {
        try {
          if (isVisible) {
            hideMenu();
            res("hidden");
          } else {
            showMenu(data.systemUpdatesCount);
            res("shown");
          }
        } catch (e) {
          console.error("Error in toggle:", e);
          res("error: toggle failed");
        }
      } else if (data.action === "is-visible") {
        res(isVisible ? "true" : "false");
      } else if (data.action === "hide") {
        try {
          hideMenu();
          res("hidden");
        } catch (e) {
          console.error("Error in hideMenu:", e);
          res("error: hide failed");
        }
      } else if (data.action === "update-count") {
        systemUpdatesCount = data.count || 0;
        if (isVisible) {
          updateMenuItems();
        }
        res("updated");
      } else {
        res("unknown action");
      }
    } catch (e) {
      console.error("Error handling request:", e);
      res(`error: ${e}`);
    }
  },
});
