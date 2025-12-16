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
let systemUpdatesCount: number = 0;
const currentMenuItems: MenuItem[] = defaultMenuItems;
const menuItemButtons: Map<string, Gtk.Button> = new Map();
let updateBadgeButton: Gtk.Button | null = null;

// Variant color schemes - using proper state colors from design tokens
const itemVariants = {
  default: {
    textColor: tokens.colors.foreground.primary.value,
    hoverBg: "#ffffff1a", // 10% opacity white
    focusBg: "#ffffff1a",
  },
  warning: {
    textColor: tokens.colors.state.warning.value,
    hoverBg: `${tokens.colors.state.warning.value}1a`, // 10% opacity
    focusBg: `${tokens.colors.state.warning.value}1a`,
  },
  danger: {
    textColor: tokens.colors.state.error.value,
    hoverBg: `${tokens.colors.state.error.value}1a`, // 10% opacity
    focusBg: `${tokens.colors.state.error.value}1a`,
  },
  suspend: {
    textColor: tokens.colors.state.purple.value,
    hoverBg: `${tokens.colors.state.purple.value}1a`, // 10% opacity
    focusBg: `${tokens.colors.state.purple.value}1a`,
  },
};

// Menu item commands - matching design system actions
const menuCommands: Record<string, string> = {
  "system-settings": "gnome-tweaks",
  "lock-screen": "hyprlock",
  applications: "io.github.flattool.Warehouse",
  documents: "nemo --existing-window /mnt/nas/FrederikDocs",
  pictures: `nemo --existing-window ${GLib.get_home_dir()}/Pictures`,
  downloads: `nemo --existing-window ${GLib.get_home_dir()}/Downloads`,
  suspend: `${GLib.get_home_dir()}/.config/hypr/scripts/confirm-suspend.sh`,
  restart: `${GLib.get_home_dir()}/.config/hypr/scripts/confirm-restart.sh`,
  shutdown: `${GLib.get_home_dir()}/.config/hypr/scripts/confirm-shutdown.sh`,
  "system-updates":
    "kitty --class flake_update_terminal -e flake_update_interactive",
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
      font-size: 13px;
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

    /* Menu item label layout */
    box.menu-item-content {
      /* spacing handled by GTK widget properties */
    }

    /* Icon styling */
    label.menu-item-icon {
      font-family: "Segoe Fluent Icons", "Segoe UI Symbol", sans-serif;
      font-size: 13px;
    }

    /* Text styling */
    label.menu-item-label {
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 13px;
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
      padding: 4px 8px;
      font-size: 13px;
      border-radius: 6px;
      min-height: 28px;
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
    label.updates-badge {
      background-color: ${tokens.colors.accent.primary.value};
      color: #ffffff;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      min-width: 16px;
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
  console.log(
    `showMenu called with updatesCount: ${updatesCount}, current count: ${systemUpdatesCount}`,
  );

  // Update system updates count if provided
  if (updatesCount !== undefined && updatesCount !== systemUpdatesCount) {
    systemUpdatesCount = updatesCount;
    console.log(`Updating menu items for new count: ${updatesCount}`);
    // Only update menu items if updates count changed
    updateMenuItems();
  }

  if (!win) {
    console.log("Window not created yet, creating...");
    createWindow();
  }

  if (win) {
    console.log("Making window visible");
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
    // Don't autofocus any element - let keyboard navigation handle focus
  } else {
    console.log("Window is null, cannot show");
  }
}

function executeMenuCommand(itemId: string) {
  const command = menuCommands[itemId];
  if (command) {
    console.log(`Executing command for ${itemId}: ${command}`);
    try {
      GLib.spawn_command_line_async(command);
      console.log(`Command executed successfully`);
    } catch (e) {
      console.error(`Failed to execute command for ${itemId}:`, e);
    }
  } else {
    console.warn(`No command found for item: ${itemId}`);
  }
  hideMenu();
}

function updateMenuItems() {
  if (!menuBox) return;

  // Clear existing items
  let child = menuBox.get_first_child();
  while (child) {
    menuBox.remove(child);
    child = menuBox.get_first_child();
  }

  // Clear button references
  menuItemButtons.clear();
  updateBadgeButton = null;

  // Add menu items
  currentMenuItems.forEach((item) => {
    if (item.id.startsWith("divider")) {
      // Add divider
      const separator = new Gtk.Separator({
        orientation: Gtk.Orientation.HORIZONTAL,
      });
      separator.add_css_class("menu-divider");
      menuBox.append(separator);
    } else {
      console.log(`Creating menu item: ${item.id}`);
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

      // Apply variant colors
      const variant = itemVariants[item.variant || "default"];
      if (variant) {
        button.add_css_class(`menu-variant-${item.variant || "default"}`);
        // Apply variant-specific CSS
        app.apply_css(
          `
           button.menu-variant-${item.variant || "default"} {
             color: ${variant.textColor};
           }
           button.menu-variant-${item.variant || "default"}:hover {
             background-color: ${variant.hoverBg};
           }
           button.menu-variant-${item.variant || "default"}:focus {
             background-color: ${variant.focusBg};
           }
           `,
          false,
        );
      }

      contentBox.append(textLabel);

      button.set_child(contentBox);

      // Connect click handler
      button.connect("clicked", () => {
        console.log(`Menu item clicked: ${item.id}`);
        executeMenuCommand(item.id);
      });

      menuBox.append(button);
      menuItemButtons.set(item.id, button);

      // Add system updates badge if applicable
      if (item.id === "system-settings" && systemUpdatesCount > 0) {
        const badgeButton = new Gtk.Button();
        badgeButton.add_css_class("system-updates-badge");
        badgeButton.set_cursor_from_name("pointer");

        const badgeContent = new Gtk.Box({
          orientation: Gtk.Orientation.HORIZONTAL,
          spacing: 8,
          halign: Gtk.Align.START,
        });
        badgeContent.add_css_class("system-updates-content");

        // Icon
        const badgeIcon = new Gtk.Label({ label: "\uE895" }); // Download icon
        badgeIcon.add_css_class("menu-item-icon");
        badgeContent.append(badgeIcon);

        // Text
        const badgeText = new Gtk.Label({
          label: "System Updates",
          halign: Gtk.Align.START,
        });
        badgeText.add_css_class("menu-item-label");
        badgeContent.append(badgeText);

        // Badge count
        const badge = new Gtk.Label({ label: systemUpdatesCount.toString() });
        badge.add_css_class("updates-badge");
        badgeContent.append(badge);

        badgeButton.set_child(badgeContent);
        badgeButton.connect("clicked", () =>
          executeMenuCommand("system-updates"),
        );

        menuBox.append(badgeButton);
        updateBadgeButton = badgeButton;
        menuItemButtons.set("system-updates", badgeButton);
      }
    }
  });
}

function createWindow() {
  console.log("Creating start menu window...");
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

      let currentFocus = focusableButtons.find((btn) => btn.has_focus());
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
        console.log(
          `Click outside menu bounds: click=(${x},${y}), menu=(${menuX},${menuY},${menuWidth},${menuHeight})`,
        );
        hideMenu();
      } else {
        console.log(
          `Click inside menu bounds: click=(${x},${y}), menu=(${menuX},${menuY},${menuWidth},${menuHeight})`,
        );
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
    console.log("Start menu daemon: initializing...");
    createWindow();
    console.log("Start menu daemon: ready for requests");
    return null;
  },
  instanceName: "start-menu-daemon",
  requestHandler(argv: string[], res: (response: string) => void) {
    try {
      const request = argv.join(" ");

      console.log(`IPC request received: "${request}"`);

      // Handle empty requests (daemon startup without arguments)
      if (!request || request.trim() === "") {
        console.log("Empty request, responding ready");
        res("ready");
        return;
      }

      const data = JSON.parse(request);
      console.log(`Parsed data:`, data);

      if (data.action === "show") {
        console.log("Action: show");
        try {
          showMenu(data.systemUpdatesCount);
          console.log("showMenu completed successfully");
          res("shown");
        } catch (e) {
          console.error("Error in showMenu:", e);
          res("error: show failed");
        }
      } else if (data.action === "toggle") {
        console.log("Action: toggle");
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
        console.log("Action: is-visible");
        res(isVisible ? "true" : "false");
      } else if (data.action === "hide") {
        console.log("Action: hide");
        try {
          hideMenu();
          res("hidden");
        } catch (e) {
          console.error("Error in hideMenu:", e);
          res("error: hide failed");
        }
      } else if (data.action === "update-count") {
        console.log("Action: update-count");
        systemUpdatesCount = data.count || 0;
        if (isVisible) {
          updateMenuItems();
        }
        res("updated");
      } else {
        console.log(`Unknown action: ${data.action}`);
        res("unknown action");
      }
    } catch (e) {
      console.error("Error handling request:", e);
      res(`error: ${e}`);
    }
  },
});
