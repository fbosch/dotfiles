import app from "ags/gtk4/app";
import { Astal } from "ags/gtk4";
import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
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
    id: "system-info",
    label: "System Info",
    icon: "\uE946", // System (Info icon)
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
  // Add --notify flag to send desktop notification after successful rebuild
  // IMPORTANT: Put the entire Fish command in quotes so flags are passed to the function
  const fishCommand =
    'fish -c "flake_update_interactive --rebuild --cache --header --notify"';

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
  updates: getSystemUpdatesCommand(), // Combined NixOS and Flatpak updates
  "system-settings": (() => {
    const terminal = getTerminal();
    const nixosPath = `${homeDir}/nixos`;

    // Different terminals use different flags for command execution
    switch (terminal) {
      case "foot":
        return `${terminal} sh -c "cd ${nixosPath} && nvim"`;
      case "kitty":
        return `${terminal} sh -c "cd ${nixosPath} && nvim"`;
      case "alacritty":
        return `${terminal} -e sh -c "cd ${nixosPath} && nvim"`;
      case "wezterm":
        return `${terminal} start --cwd ${nixosPath} -- nvim`;
      case "gnome-terminal":
        return `${terminal} --working-directory=${nixosPath} -- nvim`;
      default:
        // Fallback for xterm and others
        return `${terminal} -e sh -c "cd ${nixosPath} && nvim"`;
    }
  })(),
  "system-info": "xdg-open 'vicinae://extensions/fbosch/sysinfo/system-info'",
  "lock-screen": "hyprlock",
  applications: "com.github.tchx84.Flatseal",
  documents: "nemo --existing-window /mnt/nas/FrederikDocs",
  pictures: `nemo --existing-window ${homeDir}/Pictures`,
  downloads: `nemo --existing-window ${homeDir}/Downloads`,
  suspend: `${homeDir}/.config/hypr/scripts/confirm-suspend.sh`,
  restart: `${homeDir}/.config/hypr/scripts/confirm-restart.sh`,
  shutdown: `${homeDir}/.config/hypr/scripts/confirm-shutdown.sh`,
  "nixos-updates": getSystemUpdatesCommand(),
  "flatpak-updates": getSystemUpdatesCommand(), // Both updated during NixOS rebuild
};

// Periodic cache refresh every 5 minutes (300 seconds)
let cacheRefreshTimer: number | null = null;

function startCacheRefreshTimer() {
  // Clear any existing timer
  if (cacheRefreshTimer !== null) {
    GLib.source_remove(cacheRefreshTimer);
  }

  // Set up timer to refresh cache every 5 minutes
  cacheRefreshTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300000, () => {
    refreshCacheData();
    return GLib.SOURCE_CONTINUE; // Continue the timer
  });
}

function refreshCacheData() {
  const flakeCacheData = readFlakeUpdatesCache();
  const flatpakCacheData = readFlatpakUpdatesCache();

  let needsMenuUpdate = false;

  if (flakeCacheData) {
    const oldCount = flakeUpdatesCount;
    flakeUpdatesCount = flakeCacheData.count;
    flakeUpdatesData = flakeCacheData;
    if (oldCount !== flakeUpdatesCount) {
      needsMenuUpdate = true;
    }
  }

  if (flatpakCacheData) {
    const oldCount = flatpakUpdatesCount;
    flatpakUpdatesCount = flatpakCacheData.count;
    flatpakUpdatesData = flatpakCacheData;
    if (oldCount !== flatpakUpdatesCount) {
      needsMenuUpdate = true;
    }
  }

  // Update menu if counts changed (always update, not just when visible)
  if (needsMenuUpdate) {
    updateMenuItems();
  }
}

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

function showMenu() {
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

// Generate tooltip text for updates menu item
function generateUpdatesTooltip(): string {
  const tooltipParts: string[] = [];

  if (flakeUpdatesCount > 0) {
    if (flakeUpdatesData && flakeUpdatesData.updates.length > 0) {
      const tooltipText = flakeUpdatesData.updates
        .map((u) => `• ${u.name}: ${u.currentShort} → ${u.newShort}`)
        .join("\n");
      const timeAgo = formatTimeSince(flakeUpdatesData.timestamp);
      const lastCheckedText = timeAgo ? ` (checked ${timeAgo})` : "";
      tooltipParts.push(`NixOS Updates${lastCheckedText}:\n${tooltipText}`);
    } else {
      tooltipParts.push(
        `${flakeUpdatesCount} NixOS update${flakeUpdatesCount !== 1 ? "s" : ""} available`,
      );
    }
  }

  if (flatpakUpdatesCount > 0) {
    if (flatpakUpdatesData && flatpakUpdatesData.updates.length > 0) {
      const tooltipText = flatpakUpdatesData.updates
        .map((u) => `• ${u.name}: ${u.currentVersion} → ${u.newVersion}`)
        .join("\n");
      const timeAgo = formatTimeSince(flatpakUpdatesData.timestamp);
      const lastCheckedText = timeAgo ? ` (checked ${timeAgo})` : "";
      tooltipParts.push(`Flatpak Updates${lastCheckedText}:\n${tooltipText}`);
    } else {
      tooltipParts.push(
        `${flatpakUpdatesCount} Flatpak update${flatpakUpdatesCount !== 1 ? "s" : ""} available`,
      );
    }
  }

  return tooltipParts.join("\n\n");
}

// Create update badges for the updates menu item
function createUpdateBadges(): JSX.Element[] {
  const badges: JSX.Element[] = [];

  // Add flake updates badge if applicable
  if (flakeUpdatesCount > 0) {
    badges.push(
      <box
        orientation={Gtk.Orientation.HORIZONTAL}
        halign={Gtk.Align.END}
        valign={Gtk.Align.CENTER}
        class="updates-badge"
      >
        <label
          label={`\uF313  ${flakeUpdatesCount.toString()}`}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
        />
      </box>,
    );
  }

  // Add flatpak updates badge if applicable
  if (flatpakUpdatesCount > 0) {
    badges.push(
      <box
        orientation={Gtk.Orientation.HORIZONTAL}
        halign={Gtk.Align.END}
        valign={Gtk.Align.CENTER}
        class="updates-badge"
      >
        <label
          label={flatpakUpdatesCount.toString()}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
        />
      </box>,
    );
  }

  return badges;
}

// Create a menu item button
function createMenuItem(item: MenuItem): Gtk.Button {
  // Create badges if this is the updates item
  const badges = item.id === "updates" ? createUpdateBadges() : [];

  // Create menu item button using JSX
  const button = (
    <button
      canFocus={true}
      class={`menu-item menu-variant-${item.variant || "default"}`}
      onClicked={() => executeMenuCommand(item.id)}
      $={(self: Gtk.Button) => {
        self.set_cursor_from_name("pointer");
        menuItemButtons.set(item.id, self);

        // Set tooltip if this is the updates item
        if (item.id === "updates") {
          const tooltip = generateUpdatesTooltip();
          if (tooltip) {
            self.set_tooltip_text(tooltip);
          }

          // Store reference for tooltip updates
          if (flakeUpdatesCount > 0) {
            flakeUpdateBadgeButton = self;
          }
          if (flatpakUpdatesCount > 0) {
            flatpakUpdateBadgeButton = self;
          }
        }
      }}
    >
      <box
        orientation={Gtk.Orientation.HORIZONTAL}
        spacing={8}
        halign={Gtk.Align.FILL}
        class="menu-item-content"
      >
        <label label={item.icon} class="menu-item-icon" />
        <label
          label={item.label}
          halign={Gtk.Align.START}
          hexpand={true}
          class="menu-item-label"
        />
        {badges}
      </box>
    </button>
  ) as Gtk.Button;

  return button;
}

// Create a menu divider
function createDivider(): Gtk.Separator {
  const separator = new Gtk.Separator({
    orientation: Gtk.Orientation.HORIZONTAL,
  });
  separator.add_css_class("menu-divider");
  return separator;
}

// Build the list of menu items with dynamic updates item
function buildMenuItemsList(): MenuItem[] {
  const menuItems: MenuItem[] = [];

  // Add Updates item at the top if there are any updates
  if (flakeUpdatesCount > 0 || flatpakUpdatesCount > 0) {
    menuItems.push({
      id: "updates",
      label: "Updates",
      icon: "\uE777", // UpdateRestore icon
      variant: "default",
    });
  }

  // Add all default menu items
  menuItems.push(...defaultMenuItems);

  return menuItems;
}

function executeMenuCommand(itemId: string) {
  const command = menuCommands[itemId];
  if (command) {
    try {
      // Use sh -c to properly handle complex commands with pipes and arguments
      GLib.spawn_command_line_async(`sh -c '${command}'`);
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

  // Build dynamic menu with Updates item if there are updates
  const menuItems = buildMenuItemsList();

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
  menuItems.forEach((item) => {
    if (item.id.startsWith("divider")) {
      box.append(createDivider());
    } else {
      box.append(createMenuItem(item));
    }
  });
}

// Handle keyboard navigation in the menu
function handleKeyboardNavigation(keyval: number): boolean {
  if (keyval === Gdk.KEY_Escape) {
    hideMenu();
    return true;
  }

  const focusableButtons = Array.from(menuItemButtons.values()).filter(
    (btn) => btn.can_focus,
  );

  if (focusableButtons.length === 0) return false;

  let currentFocus = focusableButtons.find((btn) => btn.has_focus);
  let currentIndex = currentFocus ? focusableButtons.indexOf(currentFocus) : -1;

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
}

// Handle clicks outside the menu to close it
function handleOutsideClick(x: number, y: number): void {
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
}

function createWindow() {
  // Create window with JSX
  win = (
    <window
      name="start-menu"
      namespace="ags-start-menu"
      visible={false}
      anchor={
        Astal.WindowAnchor.TOP |
        Astal.WindowAnchor.BOTTOM |
        Astal.WindowAnchor.LEFT |
        Astal.WindowAnchor.RIGHT
      }
      layer={Astal.Layer.OVERLAY}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.ON_DEMAND}
      class="start-menu"
      $={(self: Astal.Window) => {
        // Add escape key handler and keyboard navigation
        const keyController = new Gtk.EventControllerKey();
        keyController.connect(
          "key-pressed",
          (_: Gtk.EventControllerKey, keyval: number) => {
            return handleKeyboardNavigation(keyval);
          },
        );
        self.add_controller(keyController);

        // Add click-anywhere handler - close menu on any click when visible
        // Use 'released' instead of 'pressed' to let button clicks process first
        const clickController = new Gtk.GestureClick();
        clickController.connect("released", (_controller, _n_press, x, y) => {
          handleOutsideClick(x, y);
        });
        self.add_controller(clickController);
      }}
    >
      <box
        orientation={Gtk.Orientation.VERTICAL}
        valign={Gtk.Align.END}
        halign={Gtk.Align.START}
      >
        <box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={0}
          class="start-menu-container"
          $={(self: Gtk.Box) => {
            menuBox = self;
            // Initialize menu items
            updateMenuItems();
          }}
        />
      </box>
    </window>
  ) as Astal.Window;
}

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
    box.start-menu-container {
      background-color: rgba(45, 45, 45, 0.90);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      padding: 5px;
      min-width: 208px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 2px 8px rgba(0, 0, 0, 0.1);
      margin-bottom: 53px; /* Waybar height (45px) + gap (8px) */
      margin-left: 8px;
    }

    /* Menu item base */
    button.menu-item {
      padding: 2px 6px;
      font-size: 14px;
      border-radius: 6px;
      min-height: 24px;
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

    /* Variant-specific styles */
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
      color: ${tokens.colors.foreground.primary.value};
    }
    button.menu-variant-warning:hover {
      color: ${tokens.colors.state.warning.value};
      background-color: ${tokens.colors.state.warning.value}1a;
    }
    button.menu-variant-warning:focus {
      color: ${tokens.colors.state.warning.value};
      background-color: ${tokens.colors.state.warning.value}1a;
    }

    button.menu-variant-danger {
      color: ${tokens.colors.foreground.primary.value};
    }
    button.menu-variant-danger:hover {
      color: ${tokens.colors.state.error.value};
      background-color: ${tokens.colors.state.error.value}1a;
    }
    button.menu-variant-danger:focus {
      color: ${tokens.colors.state.error.value};
      background-color: ${tokens.colors.state.error.value}1a;
    }

    button.menu-variant-suspend {
      color: ${tokens.colors.foreground.primary.value};
    }
    button.menu-variant-suspend:hover {
      color: ${tokens.colors.state.purple.value};
      background-color: ${tokens.colors.state.purple.value}1a;
    }
    button.menu-variant-suspend:focus {
      color: ${tokens.colors.state.purple.value};
      background-color: ${tokens.colors.state.purple.value}1a;
    }

    /* Icon styling */
    label.menu-item-icon {
      font-family: "Segoe Fluent Icons", "Segoe UI Symbol", sans-serif;
      font-size: 14px;
      min-width: 20px;
    }

    /* Label styling */
    label.menu-item-label {
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 14px;
      color: inherit;
    }

    /* Update badges */
    box.updates-badge {
      background-color: ${tokens.colors.accent.primary.value};
      color: ${tokens.colors.foreground.primary.value};
      padding: 1px 4px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
      margin-left: 6px;
    }

    box.updates-badge label {
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 11px;
      font-weight: 600;
      color: inherit;
      letter-spacing: 0.5px;
    }

    /* Menu dividers */
    separator.menu-divider {
      background-color: rgba(255, 255, 255, 0.1);
      min-height: 1px;
      margin: 4px 0;
    }
  `,
    false,
  );
}

// Apply static CSS on module load
applyStaticCSS();

// IPC to receive show/hide commands via AGS messaging
app.start({
  main() {
    // Create window immediately for responsiveness
    createWindow();

    // Load cache data on startup and update menu
    refreshCacheData();

    // Start periodic cache refresh timer (every 5 minutes)
    startCacheRefreshTimer();

    return null;
  },
  instanceName: "start-menu-daemon",
  requestHandler(argv: string[], res: (response: string) => void) {
    const request = argv.join(" ");

    // Handle empty requests (daemon startup without arguments)
    if (!request || request.trim() === "") {
      res("ready");
      return;
    }

    let data: { action?: string };
    try {
      data = JSON.parse(request);
    } catch (e) {
      console.error("Error parsing request:", e);
      res(`error: invalid JSON`);
      return;
    }

    // Handle is-visible query (no error handling needed)
    if (data.action === "is-visible") {
      res(isVisible ? "true" : "false");
      return;
    }

    // Handle actions that can throw errors
    try {
      if (data.action === "show") {
        showMenu();
        res("shown");
        return;
      }

      if (data.action === "hide") {
        hideMenu();
        res("hidden");
        return;
      }

      if (data.action === "toggle") {
        if (isVisible) {
          hideMenu();
          res("hidden");
        } else {
          showMenu();
          res("shown");
        }
        return;
      }

      if (data.action === "refresh") {
        refreshCacheData();
        res("refreshed");
        return;
      }

      // Unknown action
      res("unknown action");
    } catch (e) {
      console.error(`Error handling action '${data.action}':`, e);
      res(`error: ${data.action} failed`);
    }
  },
});
