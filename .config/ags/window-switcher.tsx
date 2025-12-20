import app from "ags/gtk4/app";
import { Astal } from "ags/gtk4";
import Gdk from "gi://Gdk?version=4.0";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import tokens from "../../design-system/tokens.json";

/**
 * Performance Optimizations:
 * 1. Icon caching - Desktop file lookups are cached to avoid repeated I/O
 * 2. Smart UI updates - Only rebuild UI when window list changes; otherwise just update CSS classes
 * 3. Window list caching - During switcher session, reuse window list instead of re-fetching
 * 4. Event-driven Alt monitoring - Uses GDK key events instead of polling for better performance
 */

// Hyprland client interface
interface HyprlandClient {
  address: string;
  class: string;
  title: string;
  workspace: {
    id: number;
    name: string;
  };
}

// Window info for display
interface WindowInfo {
  address: string;
  class: string;
  title: string;
  workspace: string;
}

// Configuration
const ICON_SIZE = 64;

// State
let win: Astal.Window | null = null;
let containerBox: Gtk.Box | null = null;
let selectedNameLabel: Gtk.Label | null = null;
let isVisible = false;
let windowButtons: Map<string, Gtk.Button> = new Map();
let currentWindows: WindowInfo[] = [];
let currentIndex = 0;

// Icon theme reference (initialized in createWindow)
let iconTheme: Gtk.IconTheme | null = null;

// Icon name cache to avoid repeated desktop file lookups
const iconCache = new Map<string, string | null>();

// Get icon name from desktop file based on app class
function getIconNameForClass(appClass: string): string | null {
  if (!appClass) return null;

  // Check cache first
  if (iconCache.has(appClass)) {
    return iconCache.get(appClass)!;
  }

  // Try to find desktop file for this app class
  // Try exact class name first, then lowercase
  const attempts = [`${appClass}.desktop`, `${appClass.toLowerCase()}.desktop`];

  let iconName: string | null = null;

  for (const desktopId of attempts) {
    try {
      // @ts-ignore - DesktopAppInfo exists in Gio but may not be in type definitions
      const appInfo = Gio.DesktopAppInfo.new(desktopId);
      if (!appInfo) continue;

      // Get the icon from the desktop file
      const icon = appInfo.get_icon();
      if (!icon) continue;

      // If it's a themed icon, get the icon name
      if (icon instanceof Gio.ThemedIcon) {
        const names = icon.get_names();
        if (names && names.length > 0) {
          // Return the first icon name
          iconName = names[0];
          break;
        }
      }

      // If it's a file icon, we could get the path, but for now skip
      // as we want themed icons for consistency
    } catch (e) {
      // Desktop file not found or error parsing, try next
      continue;
    }
  }

  // If no desktop file found, try checking icon theme directly
  // This handles apps that install icons but not desktop files
  if (!iconName && iconTheme) {
    const iconAttempts = [
      appClass,
      appClass.toLowerCase(),
      appClass.toLowerCase().replace(/\s+/g, "-"),
    ];

    for (const name of iconAttempts) {
      if (iconTheme.has_icon(name)) {
        iconName = name;
        break;
      }
    }
  }

  // Cache the result (even if null)
  iconCache.set(appClass, iconName);
  return iconName;
}

// Get windows from hyprctl
function getWindows(): WindowInfo[] {
  try {
    const [ok, stdout] = GLib.spawn_command_line_sync("hyprctl clients -j");
    if (!ok || !stdout) return [];

    const decoder = new TextDecoder("utf-8");
    const jsonStr = decoder.decode(stdout);
    const clients = JSON.parse(jsonStr) as HyprlandClient[];

    // Filter out special workspaces and sort by class, title, address
    return clients
      .filter((c) => c.workspace.id !== -1)
      .sort((a, b) => {
        if (a.class !== b.class) return a.class.localeCompare(b.class);
        if (a.title !== b.title) return a.title.localeCompare(b.title);
        return a.address.localeCompare(b.address);
      })
      .map((c) => ({
        address: c.address,
        class: c.class || "",
        title: c.title || "",
        workspace: c.workspace.name || c.workspace.id.toString(),
      }));
  } catch (e) {
    console.error("Error getting windows from hyprctl:", e);
    return [];
  }
}

// Get currently active window address
function getActiveWindowAddress(): string | null {
  try {
    const [ok, stdout] = GLib.spawn_command_line_sync(
      "hyprctl activewindow -j",
    );
    if (!ok || !stdout) return null;

    const decoder = new TextDecoder("utf-8");
    const jsonStr = decoder.decode(stdout);
    const activeWindow = JSON.parse(jsonStr);
    return activeWindow.address || null;
  } catch (e) {
    console.error("Error getting active window:", e);
    return null;
  }
}

// Create an app icon button
function createAppButton(
  window: WindowInfo,
  isSelected: boolean,
  index: number,
): Gtk.Button {
  const iconName = getIconNameForClass(window.class || "");

  const button = (
    <button
      canFocus={false}
      class={`app-button ${isSelected ? "selected" : ""}`}
      onClicked={() => {
        currentIndex = index;
        commitSwitch();
      }}
    >
      <box
        orientation={Gtk.Orientation.VERTICAL}
        spacing={0}
        halign={Gtk.Align.CENTER}
        valign={Gtk.Align.CENTER}
      >
        {/* Icon container with fixed size */}
        <box
          orientation={Gtk.Orientation.HORIZONTAL}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
          class={`icon-container ${iconName ? "" : "letter-icon"}`}
        >
          {iconName ? (
            <image
              iconName={iconName}
              pixelSize={ICON_SIZE}
              class="app-icon-image"
            />
          ) : (
            <box class="app-icon-wrapper">
              <label
                label={(window.class || "?").charAt(0).toUpperCase()}
                halign={Gtk.Align.CENTER}
                valign={Gtk.Align.CENTER}
                class="app-icon-letter"
              />
            </box>
          )}
        </box>
      </box>
    </button>
  ) as Gtk.Button;

  return button;
}

// Previous window list to detect changes
let previousWindowAddresses: string[] = [];

// Update the switcher display with new data
function updateSwitcher() {
  if (!containerBox || !selectedNameLabel) return;

  // Check if window list has changed
  const currentAddresses = currentWindows.map((w) => w.address);
  const windowListChanged =
    previousWindowAddresses.length !== currentAddresses.length ||
    previousWindowAddresses.some((addr, idx) => addr !== currentAddresses[idx]);

  if (windowListChanged) {
    // Rebuild entire UI only when window list changes
    let child = containerBox.get_first_child();
    while (child) {
      containerBox.remove(child);
      child = containerBox.get_first_child();
    }
    windowButtons.clear();

    // Create buttons for each window
    currentWindows.forEach((window, index) => {
      const isSelected = index === currentIndex;
      const button = createAppButton(window, isSelected, index);
      containerBox!.append(button);
      windowButtons.set(window.address, button);
    });

    previousWindowAddresses = currentAddresses;
  } else {
    // Just update selection classes (much faster)
    currentWindows.forEach((window, index) => {
      const button = windowButtons.get(window.address);
      if (!button) return;

      const isSelected = index === currentIndex;
      const classes = button.get_css_classes();
      const hasSelected = classes.includes("selected");

      if (isSelected && !hasSelected) {
        button.add_css_class("selected");
      } else if (!isSelected && hasSelected) {
        button.remove_css_class("selected");
      }
    });
  }

  // Update selected app name
  const selectedWindow = currentWindows[currentIndex];
  if (selectedWindow) {
    selectedNameLabel.set_label(selectedWindow.title);
  }
}

// Focus the currently selected window
function commitSwitch() {
  if (currentWindows.length === 0) {
    hideSwitcher();
    return;
  }

  const targetWindow = currentWindows[currentIndex];
  if (!targetWindow) {
    hideSwitcher();
    return;
  }

  try {
    GLib.spawn_command_line_async(
      `hyprctl dispatch focuswindow address:${targetWindow.address}`,
    );
  } catch (e) {
    console.error("Error focusing window:", e);
  }

  hideSwitcher();
}

// Cycle to next/previous window (shows UI immediately, commits only on release)
function cycleWindow(direction: "next" | "prev") {
  // On first call (when not visible), fetch windows and initialize
  if (!isVisible) {
    const windows = getWindows();

    if (windows.length === 0) return;
    if (windows.length === 1) return;

    const activeAddress = getActiveWindowAddress();
    let currentIdx = windows.findIndex((w) => w.address === activeAddress);

    // If current window not found, start from first/last based on direction
    if (currentIdx === -1) {
      currentIdx = direction === "next" ? 0 : windows.length - 1;
    }

    currentWindows = windows;
    currentIndex = currentIdx;
  }

  // For subsequent calls, reuse cached window list
  if (currentWindows.length === 0) return;
  if (currentWindows.length === 1) return;

  // Cycle the selection
  if (direction === "next") {
    currentIndex = (currentIndex + 1) % currentWindows.length;
  } else {
    currentIndex =
      (currentIndex - 1 + currentWindows.length) % currentWindows.length;
  }

  // Show/update the overlay immediately
  showSwitcher();
}

// Show the switcher overlay
function showSwitcher() {
  if (!win) return;

  updateSwitcher();

  if (!isVisible) {
    win.set_visible(true);
    isVisible = true;
  }
}

// Monitor for Alt key release using GDK events (set up once at window creation)
function setupAltMonitoring() {
  if (!win) return;

  // Create a key event controller
  const controller = new Gtk.EventControllerKey();

  // Listen for key release events
  controller.connect(
    "key-released",
    (
      _ctrl: Gtk.EventControllerKey,
      keyval: number,
      _keycode: number,
      _state: Gdk.ModifierType,
    ) => {
      // Only act if switcher is visible
      if (!isVisible) return;

      // Check if Alt key was released
      // Alt_L = 65513 (0xffe9), Alt_R = 65514 (0xffea)
      if (keyval === 65513 || keyval === 65514) {
        console.log("Alt key released, committing switch");
        commitSwitch();
      }
    },
  );

  win.add_controller(controller);
}

// Hide the switcher overlay
function hideSwitcher() {
  if (!win) return;

  if (isVisible) {
    win.set_visible(false);
    isVisible = false;
  }
}

// Create the switcher window
function createWindow() {
  // Initialize icon theme
  const display = Gdk.Display.get_default();
  if (display) {
    iconTheme = Gtk.IconTheme.get_for_display(display);
  }

  win = (
    <window
      name="window-switcher"
      namespace="ags-window-switcher"
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
      class="window-switcher"
    >
      <box
        orientation={Gtk.Orientation.VERTICAL}
        halign={Gtk.Align.CENTER}
        valign={Gtk.Align.CENTER}
      >
        <box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={12}
          class="switcher-container"
        >
          {/* App icons row */}
          <box
            orientation={Gtk.Orientation.HORIZONTAL}
            spacing={8}
            halign={Gtk.Align.CENTER}
            class="apps-row"
            $={(self: Gtk.Box) => {
              containerBox = self;
            }}
          />

          {/* Selected app name */}
          <label
            label=""
            halign={Gtk.Align.CENTER}
            class="app-name"
            ellipsize={3}
            maxWidthChars={50}
            $={(self: Gtk.Label) => {
              selectedNameLabel = self;
            }}
          />
        </box>
      </box>
    </window>
  ) as Astal.Window;

  // Set up Alt key monitoring (always listening, but only acts when visible)
  setupAltMonitoring();
}

// Apply static CSS
app.apply_css(
  `
  window.window-switcher {
    background-color: transparent;
    border: none;
  }
  
  box.switcher-container {
    background-color: rgba(45, 45, 45, 0.90);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 18px;
    padding: 24px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }
  
  box.apps-row {
    min-height: ${ICON_SIZE + 16}px;
  }
  
  button.app-button {
    padding: 8px;
    border-radius: 12px;
    border: 2px solid transparent;
    background-color: transparent;
    transition: all 150ms ease;
  }
  
  button.app-button:hover {
    border-color: rgba(255, 255, 255, 0.3);
  }
  
  button.app-button.selected {
    background-color: rgba(55, 55, 55, 0.6);
    border-color: ${tokens.colors.accent.active.value};
  }
  
  button.app-button.selected:hover {
    border-color: ${tokens.colors.accent.active.value};
  }
  
  box.icon-container {
    min-width: ${ICON_SIZE}px;
    min-height: ${ICON_SIZE}px;
    border-radius: 12px;
  }
  
  box.icon-container.letter-icon {
    background-color: ${tokens.colors.accent.primary.value};
  }
  
  image.app-icon-image {
    min-width: ${ICON_SIZE}px;
    min-height: ${ICON_SIZE}px;
  }
  
  label.app-icon-letter {
    font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
    font-weight: 600;
    font-size: 28px;
    color: ${tokens.colors.foreground.primary.value};
    min-width: ${ICON_SIZE}px;
    min-height: ${ICON_SIZE}px;
  }
  
  label.app-name {
    font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
    font-size: 14px;
    color: ${tokens.colors.foreground.primary.value};
    max-width: 600px;
  }
  `,
  false,
);

// IPC daemon
app.start({
  main() {
    createWindow();
    return win;
  },
  instanceName: "window-switcher-daemon",
  requestHandler(argv: string[], res: (response: string) => void) {
    try {
      const request = argv.join(" ");

      if (!request || request.trim() === "") {
        res("ready");
        return;
      }

      const data = JSON.parse(request);

      if (data.action === "show") {
        // Initialize the switcher with first window selected
        const windows = getWindows();
        if (windows.length > 0) {
          const activeAddress = getActiveWindowAddress();
          let currentIdx = windows.findIndex(
            (w) => w.address === activeAddress,
          );
          currentIdx = currentIdx === -1 ? 0 : currentIdx;

          currentWindows = windows;
          currentIndex = currentIdx;
          showSwitcher();
        }
        res("shown");
      } else if (data.action === "next") {
        cycleWindow("next");
        res("cycled next");
      } else if (data.action === "prev") {
        cycleWindow("prev");
        res("cycled prev");
      } else if (data.action === "commit") {
        commitSwitch();
        res("committed");
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
