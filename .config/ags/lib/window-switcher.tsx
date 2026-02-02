import app from "ags/gtk4/app";
import { Astal } from "ags/gtk4";
import Gdk from "gi://Gdk?version=4.0";
import GdkPixbuf from "gi://GdkPixbuf?version=2.0";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import tokens from "../../../design-system/tokens.json";
import { perf } from "./performance-monitor";

/**
 * Performance Optimizations:
 * 1. Icon caching - Desktop file lookups are cached to avoid repeated I/O
 * 2. Smart UI updates - Only rebuild UI when window list changes; otherwise just update CSS classes
 * 3. Window list caching - During switcher session, reuse window list instead of re-fetching
 * 4. Event-driven Alt monitoring - Uses GDK key events instead of polling for better performance
 *
 * State Machine:
 * - IDLE: Switcher hidden, waiting for Alt+Tab
 * - ACTIVE: Switcher visible, cycling through windows, waiting for Alt release
 *
 * Transitions:
 * - IDLE + (next/prev with >1 windows) -> ACTIVE
 * - ACTIVE + next/prev -> ACTIVE (cycles selection)
 * - ACTIVE + Alt release -> IDLE (commits and hides)
 * - ACTIVE + hide -> IDLE (just hides)
 */

// State machine
enum SwitcherState {
  IDLE = "IDLE",
  ACTIVE = "ACTIVE",
}

// Display mode
enum DisplayMode {
  ICONS = "ICONS",
  PREVIEWS = "PREVIEWS",
}

// Sort mode
enum SortMode {
  ALPHABETICAL = "ALPHABETICAL",
  RECENCY = "RECENCY",
}

// Hyprland client interface
interface HyprlandClient {
  address: string;
  class: string;
  title: string;
  workspace: {
    id: number;
    name: string;
  };
  at?: [number, number];
  size?: [number, number];
}

// Window info for display
interface WindowInfo {
  address: string;
  class: string;
  title: string;
  workspace: string;
  size?: {
    width: number;
    height: number;
  };
  position?: {
    x: number;
    y: number;
  };
}

// Configuration
const ICON_SIZE = 64;
const PREVIEW_HEIGHT = 180; // Target height for previews
const PREVIEW_MAX_WIDTH = 320; // Maximum width for very wide windows
const PREVIEW_MIN_WIDTH = 30; // Minimum width for very narrow windows
const SWITCHER_PADDING = 24; // Padding inside switcher container
const SWITCHER_MARGIN = 48; // Margin from screen edges (total for both sides)
const MONITOR_EDGE_MARGIN = 30; // Additional margin from monitor edges (per side)
const BUTTON_SPACING = 8; // Spacing between buttons
const BUTTON_PADDING = 8; // Padding inside each button

// State
let state: SwitcherState = SwitcherState.IDLE;

// Check if performance mode is active on startup
let displayMode: DisplayMode = DisplayMode.PREVIEWS;
let sortMode: SortMode = SortMode.RECENCY; // Default to recency like Windows 11
try {
  const perfModeFile = Gio.File.new_for_path("/tmp/hypr-performance-mode");
  if (perfModeFile.query_exists(null)) {
    displayMode = DisplayMode.ICONS;
    console.log("Performance mode detected, starting in ICONS mode");
  }
} catch (e) {
  // Ignore errors, default to PREVIEWS
}

let win: Astal.Window | null = null;
let containerBox: Gtk.Box | null = null;
let appsRowBox: Gtk.Box | null = null; // Reference to apps-row for wrapping
let selectedNameLabel: Gtk.Label | null = null;
let isVisible = false; // Derived from state, kept for GTK
let windowButtons: Map<string, Gtk.Button> = new Map();
let currentWindows: WindowInfo[] = [];
let currentIndex = 0;

// Icon theme reference (initialized in createWindow)
let iconTheme: Gtk.IconTheme | null = null;

// Icon name cache to avoid repeated desktop file lookups
const iconCache = new Map<string, string | null>();

// Persistent focus history for recency-based sorting
// Most recently focused window is at index 0
let focusHistory: string[] = [];

// Get current monitor width
function getMonitorWidth(): number {
  try {
    const display = Gdk.Display.get_default();
    if (!display) {
      GLib.file_set_contents('/tmp/monitor-debug.log', 'No display found\n');
      return 1920; // Fallback
    }
    
    // Get the monitor containing the mouse pointer
    const seat = display.get_default_seat();
    if (!seat) {
      GLib.file_set_contents('/tmp/monitor-debug.log', 'No seat found\n');
      return 1920;
    }
    
    const pointer = seat.get_pointer();
    if (!pointer) {
      GLib.file_set_contents('/tmp/monitor-debug.log', 'No pointer found\n');
      return 1920;
    }
    
    const [, x, y] = pointer.get_position();
    const monitor = display.get_monitor_at_point(x, y);
    
    if (!monitor) {
      GLib.file_set_contents('/tmp/monitor-debug.log', `No monitor at point ${x},${y}\n`);
      return 1920;
    }
    
    const geometry = monitor.get_geometry();
    const model = monitor.get_model() || "unknown";
    const scaleFactor = monitor.get_scale_factor();
    
    const debugInfo = `Monitor: ${model}
Geometry width: ${geometry.width}
Geometry height: ${geometry.height}
Scale factor: ${scaleFactor}
Physical width: ${geometry.width * scaleFactor}
Mouse position: ${x},${y}
`;
    GLib.file_set_contents('/tmp/monitor-debug.log', debugInfo);
    
    return geometry.width;
  } catch (e) {
    GLib.file_set_contents('/tmp/monitor-debug.log', `Error: ${e}\n`);
    console.error("Failed to get monitor width:", e);
    return 1920; // Fallback to common resolution
  }
}

// Calculate button width based on display mode and window info
// IMPORTANT: This must match the actual button size created in createAppButton
function calculateButtonWidth(window: WindowInfo): number {
  if (displayMode === DisplayMode.ICONS) {
    // Icon mode: button padding (8*2) + border (2*2) + icon size (64) + GTK overhead (12)
    return ICON_SIZE + (BUTTON_PADDING * 2) + 4 + 12;
  } else {
    // Preview mode: calculate from preview dimensions
    const previewPath = captureWindowPreview(window.address);
    const dimensions = calculatePreviewDimensions(previewPath);
    // Button width = preview content width + button padding + border + GTK layout overhead
    // Preview content includes: preview-header padding (12*2) already in dimensions.width
    // Add extra 48px for GTK's internal layout, focus rings, margins, and box model discrepancies
    return dimensions.width + (BUTTON_PADDING * 2) + 4 + 48;
  }
}

// Directory for window preview screenshots (managed by window-capture-daemon.sh)
// Uses /dev/shm (tmpfs) for faster I/O, falls back to /tmp if unavailable
const PREVIEW_CACHE_DIR = GLib.file_test("/dev/shm", GLib.FileTest.IS_DIR)
  ? "/dev/shm/hypr-window-captures"
  : `${GLib.get_tmp_dir()}/hypr-window-captures`;

// Get window preview path if it exists (screenshots managed by window-capture-daemon.sh)
// Screenshots are named {address}.jpg (fixed filename, no timestamp)
function captureWindowPreview(windowAddress: string): string | null {
  if (!windowAddress) return null;

  const addressClean = windowAddress.replace(/^0x/, "");
  const previewPath = `${PREVIEW_CACHE_DIR}/${addressClean}.jpg`;

  try {
    const file = Gio.File.new_for_path(previewPath);
    if (file.query_exists(null)) {
      return previewPath;
    }
  } catch (e) {
    console.error(`Failed to find preview for ${windowAddress}:`, e);
  }

  return null;
}

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

/**
 * Truncate title to fit within available width
 * Font: 13px at 500 weight (medium)
 * Average character width: ~6px for proportional fonts
 */
function truncateTitle(title: string, availableWidth: number): string {
  const AVG_CHAR_WIDTH = 6; // Less conservative for better fit
  const ELLIPSIS_WIDTH = 12; // Actual width of "…" 
  
  const maxChars = Math.floor((availableWidth - ELLIPSIS_WIDTH) / AVG_CHAR_WIDTH);
  
  if (maxChars <= 0) {
    return "…";
  }
  
  if (title.length <= maxChars) {
    return title;
  }
  
  // Truncate and add ellipsis
  return title.substring(0, maxChars) + "…";
}

// Get preview dimensions directly from image file (source of truth)
// Uses PREVIEW_HEIGHT as the target, constrains width to PREVIEW_MAX_WIDTH
function calculatePreviewDimensions(imagePath: string | null): {
  width: number;
  height: number;
} {
  const mark = perf.start("window-switcher", "calculatePreviewDimensions");
  if (!imagePath) {
    // Fallback to minimum width with target height if no image
    const result = { width: PREVIEW_MIN_WIDTH, height: PREVIEW_HEIGHT };
    mark.end(true);
    return result;
  }

  try {
    // Load the image via memory stream to bypass caching
    const file = Gio.File.new_for_path(imagePath);
    const [success, contents] = file.load_contents(null);
    
    if (!success || !contents) {
      const result = { width: PREVIEW_MIN_WIDTH, height: PREVIEW_HEIGHT };
      mark.end(true);
      return result;
    }
    
    const stream = Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(contents));
    const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
    
    if (!pixbuf) {
      const result = { width: PREVIEW_MIN_WIDTH, height: PREVIEW_HEIGHT };
      mark.end(true);
      return result;
    }

    // Get actual image dimensions
    const imageWidth = pixbuf.get_width();
    const imageHeight = pixbuf.get_height();
    const aspectRatio = imageWidth / imageHeight;

    // Start with target height
    let height = PREVIEW_HEIGHT;
    let width = Math.round(height * aspectRatio);

    // If width exceeds maximum, constrain by width instead
    if (width > PREVIEW_MAX_WIDTH) {
      width = PREVIEW_MAX_WIDTH;
      height = Math.round(width / aspectRatio);
    }

    // Enforce minimum width
    width = Math.max(PREVIEW_MIN_WIDTH, width);

    console.log(`Preview dimensions for ${imagePath}: ${imageWidth}x${imageHeight} → ${width}x${height} (aspect: ${aspectRatio.toFixed(2)})`);

    const result = { width, height };
    mark.end(true);
    return result;
  } catch (e) {
    console.error("Failed to get image dimensions:", e);
    const result = { width: PREVIEW_MIN_WIDTH, height: PREVIEW_HEIGHT };
    mark.end(false, String(e));
    return result;
  }
}

// Get windows from hyprctl
function getWindows(): WindowInfo[] {
  try {
    const [ok, stdout] = GLib.spawn_command_line_sync("hyprctl clients -j");
    if (!ok || !stdout) return [];

    const decoder = new TextDecoder("utf-8");
    const jsonStr = decoder.decode(stdout);
    const clients = JSON.parse(jsonStr) as HyprlandClient[];

    // Filter out special workspaces
    const filteredClients = clients
      .filter((c) => c.workspace.id !== -1)
      .map((c) => ({
        address: c.address,
        class: c.class || "",
        title: c.title || "",
        workspace: c.workspace.name || c.workspace.id.toString(),
        size: (c as any).size
          ? { width: (c as any).size[0], height: (c as any).size[1] }
          : undefined,
        position: (c as any).at
          ? { x: (c as any).at[0], y: (c as any).at[1] }
          : undefined,
      }));

    // Sort based on current sort mode
    if (sortMode === SortMode.RECENCY) {
      // Get focus history for recency-based sorting
      const focusHistory = getWindowFocusHistory();
      
      return filteredClients.sort((a, b) => {
        const indexA = focusHistory.indexOf(a.address);
        const indexB = focusHistory.indexOf(b.address);
        
        // Windows in history come first, sorted by recency (lower index = more recent)
        // Windows not in history come last, sorted alphabetically
        if (indexA !== -1 && indexB !== -1) {
          return indexA - indexB; // Most recent first
        } else if (indexA !== -1) {
          return -1; // a is in history, b is not
        } else if (indexB !== -1) {
          return 1; // b is in history, a is not
        } else {
          // Neither in history, sort alphabetically as fallback
          if (a.class !== b.class) return a.class.localeCompare(b.class);
          if (a.title !== b.title) return a.title.localeCompare(b.title);
          return a.address.localeCompare(b.address);
        }
      });
    } else {
      // ALPHABETICAL mode - original behavior
      return filteredClients.sort((a, b) => {
        if (a.class !== b.class) return a.class.localeCompare(b.class);
        if (a.title !== b.title) return a.title.localeCompare(b.title);
        return a.address.localeCompare(b.address);
      });
    }
  } catch (e) {
    console.error("Error getting windows from hyprctl:", e);
    return [];
  }
}

// Get window focus history from Hyprland event logs
// Returns array of window addresses sorted by recency (most recent first)
function getWindowFocusHistory(): string[] {
  return focusHistory;
}

// Update focus history when a window is focused
// Most recently focused window goes to index 0
function updateFocusHistory(address: string) {
  if (!address) return;
  
  // Remove address if it exists (to avoid duplicates)
  const index = focusHistory.indexOf(address);
  if (index !== -1) {
    focusHistory.splice(index, 1);
  }
  
  // Add to front (most recent)
  focusHistory.unshift(address);
  
  // Limit history size to 50 windows
  if (focusHistory.length > 50) {
    focusHistory = focusHistory.slice(0, 50);
  }
  
  console.log(`Focus history updated: [${focusHistory.slice(0, 5).join(", ")}...]`);
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
  const mark = perf.start("window-switcher", "createAppButton");
  let ok = true;
  let error: string | undefined;
  try {
    const iconName = getIconNameForClass(window.class || "");

    console.log(`Creating button for ${window.class} in ${displayMode} mode`);

    // Determine content based on display mode
    let content: JSX.Element;

    if (displayMode === DisplayMode.PREVIEWS) {
      // Preview mode: show aspect-ratio box with header
      const previewPath = captureWindowPreview(window.address);
      const dimensions = calculatePreviewDimensions(previewPath);

      content = (
        <box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={0}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
          class="preview-wrapper"
        >
          {/* Preview container with header and body */}
          <box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={0}
            class="window-preview"
            css={`
              max-width: ${dimensions.width}px;
            `}
          >
            {/* Header with icon and title */}
            <box
              orientation={Gtk.Orientation.HORIZONTAL}
              spacing={8}
              class="preview-header"
              halign={Gtk.Align.FILL}
              widthRequest={dimensions.width}
            >
              {/* App icon */}
              {iconName ? (
                <image
                  iconName={iconName}
                  pixelSize={20}
                  class="preview-header-icon"
                />
              ) : (
                <box class="preview-header-icon-fallback">
                  <label
                    label={(window.class || "?").charAt(0).toUpperCase()}
                    class="preview-header-letter"
                  />
                </box>
              )}

              {/* App title - truncated to fit available width */}
              <label
                label={truncateTitle(window.title, dimensions.width - 28 - 24)}
                xalign={0}
                class="preview-header-title"
                wrap={false}
              />
            </box>

            {/* Preview body with screenshot or gradient fallback */}
            <box
              class="preview-body"
              halign={Gtk.Align.CENTER}
              valign={Gtk.Align.CENTER}
              css={`
                min-width: ${dimensions.width}px;
                min-height: ${dimensions.height}px;
                max-width: ${dimensions.width}px;
                max-height: ${dimensions.height}px;
              `}
              $={(self: Gtk.Box) => {
                if (previewPath) {
                  // Load and scale the image using GdkPixbuf
                  // Read file contents directly to bypass GdkPixbuf file caching
                  // Force fresh load by reading file every time UI rebuilds
                  try {
                    const file = Gio.File.new_for_path(previewPath);
                    
                    // Query file info to ensure we're getting the latest version
                    const fileInfo = file.query_info(
                      "standard::*,time::modified",
                      Gio.FileQueryInfoFlags.NONE,
                      null
                    );
                    const modTime = fileInfo.get_modification_time().tv_sec;
                    
                    const [success, contents] = file.load_contents(null);
                    
                    if (success && contents) {
                      // Create a unique stream for each load to prevent caching
                      const bytes = new GLib.Bytes(contents);
                      const stream = Gio.MemoryInputStream.new_from_bytes(bytes);
                      const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
                      
                      if (pixbuf) {
                        const actualWidth = pixbuf.get_width();
                        const actualHeight = pixbuf.get_height();
                        console.log(`Rendering ${previewPath.split('/').pop()} (mtime: ${modTime}): image=${actualWidth}x${actualHeight}, target=${dimensions.width}x${dimensions.height}`);
                        
                        const scaledPixbuf = pixbuf.scale_simple(
                          dimensions.width,
                          dimensions.height,
                          GdkPixbuf.InterpType.BILINEAR,
                        );

                        if (scaledPixbuf) {
                          const texture = Gdk.Texture.new_for_pixbuf(scaledPixbuf);
                          const picture = Gtk.Picture.new_for_paintable(texture);
                          picture.set_halign(Gtk.Align.FILL);
                          picture.set_valign(Gtk.Align.FILL);
                          picture.set_can_shrink(false);
                          picture.set_content_fit(Gtk.ContentFit.FILL);
                          picture.add_css_class("preview-image");
                          self.append(picture);
                        }
                      }
                    }
                  } catch (e) {
                    console.error("Failed to load preview image:", e);
                  }
                }
              }}
            />
          </box>
        </box>
      );
    } else {
      // Icon mode: original behavior
      content = (
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
      );
    }

    const button = (
      <button
        canFocus={false}
        class={`app-button ${isSelected ? "selected" : ""}`}
        onClicked={() => {
          currentIndex = index;
          commitSwitch();
        }}
      >
        {content}
      </button>
    ) as Gtk.Button;

    return button;
  } catch (e) {
    ok = false;
    error = String(e);
    throw e;
  } finally {
    mark.end(ok, error);
  }
}

// Previous window list to detect changes
let previousWindowAddresses: string[] = [];
let previousDisplayMode: DisplayMode = displayMode;

// Update the switcher display with new data
function updateSwitcher() {
  if (!containerBox || !selectedNameLabel) return;
  const mark = perf.start("window-switcher", "updateSwitcher");
  let ok = true;
  let error: string | undefined;

  try {
    // Check if window list has changed
    const currentAddresses = currentWindows.map((w) => w.address);
    const windowListChanged =
      previousWindowAddresses.length !== currentAddresses.length ||
      previousWindowAddresses.some((addr, idx) => addr !== currentAddresses[idx]);

    // Check if display mode has changed
    const modeChanged = previousDisplayMode !== displayMode;

    // In preview mode, always rebuild UI to get fresh screenshots
    // Also rebuild if mode changed or window list changed
    const shouldRebuild = windowListChanged || modeChanged || displayMode === DisplayMode.PREVIEWS;

    if (shouldRebuild) {
      // Clear existing UI
      let child = containerBox.get_first_child();
      while (child) {
        containerBox.remove(child);
        child = containerBox.get_first_child();
      }
      windowButtons.clear();

      // Calculate available width for buttons
      const monitorWidth = getMonitorWidth();
      // Use 75% of monitor width - conservative limit to prevent overflow
      // GTK adds significant overhead (borders, focus rings, spacing) that's hard to calculate precisely
      const maxWidth = Math.floor(monitorWidth * 0.75);
      
      // Calculate button widths
      const buttonWidths = currentWindows.map(w => calculateButtonWidth(w));
      
      // Write debug info to file for inspection
      const debugInfo = `[Window Switcher Debug - ${new Date().toISOString()}]
Monitor: ${monitorWidth}px
Max width (75% of monitor): ${maxWidth}px
Button widths: [${buttonWidths.join(', ')}]
Total width needed: ${buttonWidths.reduce((sum, w) => sum + w, 0) + (currentWindows.length - 1) * BUTTON_SPACING}px
Will wrap: ${(buttonWidths.reduce((sum, w) => sum + w, 0) + (currentWindows.length - 1) * BUTTON_SPACING) > maxWidth}
`;
      GLib.file_set_contents('/tmp/ags-window-switcher-debug.log', debugInfo);
      
      console.log(`[Window Switcher] Button widths: [${buttonWidths.join(', ')}]`);
      
      const totalWidth = buttonWidths.reduce((sum, w) => sum + w, 0) + 
                        (currentWindows.length - 1) * BUTTON_SPACING;
      
      console.log(`[Window Switcher] Monitor: ${monitorWidth}px, Available (75%): ${maxWidth}px, Total needed: ${totalWidth}px, Will wrap: ${totalWidth > maxWidth}`);
      
      // Determine if we need to wrap
      if (totalWidth > maxWidth) {
        // Multi-row layout
        console.log("Using multi-row layout");
        
        // Create rows and distribute windows
        const rows: WindowInfo[][] = [];
        let currentRow: WindowInfo[] = [];
        let currentRowWidth = 0;
        
        currentWindows.forEach((window, idx) => {
          const buttonWidth = buttonWidths[idx];
          const widthWithSpacing = currentRowWidth > 0 ? buttonWidth + BUTTON_SPACING : buttonWidth;
          
          console.log(`[Window Switcher] Window ${idx} (${window.class}): width=${buttonWidth}px, currentRowWidth=${currentRowWidth}px, will add=${widthWithSpacing}px, fits=${currentRowWidth + widthWithSpacing <= maxWidth}`);
          
          if (currentRowWidth + widthWithSpacing <= maxWidth) {
            // Fits in current row
            currentRow.push(window);
            currentRowWidth += widthWithSpacing;
          } else {
            // Start new row
            if (currentRow.length > 0) {
              console.log(`[Window Switcher] Row ${rows.length} complete with ${currentRow.length} windows, total width: ${currentRowWidth}px`);
              rows.push(currentRow);
            }
            currentRow = [window];
            currentRowWidth = buttonWidth;
          }
        });
        
        // Add last row
        if (currentRow.length > 0) {
          console.log(`[Window Switcher] Row ${rows.length} (final) complete with ${currentRow.length} windows, total width: ${currentRowWidth}px`);
          rows.push(currentRow);
        }
        
        console.log(`[Window Switcher] Created ${rows.length} rows, max allowed width per row: ${maxWidth}px`);
        
        // Build rows
        rows.forEach(rowWindows => {
          const rowBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: BUTTON_SPACING,
            halign: Gtk.Align.CENTER,
          });
          rowBox.add_css_class("apps-row");
          
          rowWindows.forEach(window => {
            const windowIndex = currentWindows.indexOf(window);
            const isSelected = windowIndex === currentIndex;
            const button = createAppButton(window, isSelected, windowIndex);
            rowBox.append(button);
            windowButtons.set(window.address, button);
          });
          
          containerBox!.append(rowBox);
        });
      } else {
        // Single-row layout (original behavior)
        console.log("Using single-row layout");
        
        const rowBox = new Gtk.Box({
          orientation: Gtk.Orientation.HORIZONTAL,
          spacing: BUTTON_SPACING,
          halign: Gtk.Align.CENTER,
        });
        rowBox.add_css_class("apps-row");
        
        currentWindows.forEach((window, index) => {
          const isSelected = index === currentIndex;
          const button = createAppButton(window, isSelected, index);
          rowBox.append(button);
          windowButtons.set(window.address, button);
        });
        
        containerBox!.append(rowBox);
      }

      previousWindowAddresses = currentAddresses;
      previousDisplayMode = displayMode;
    } else {
      // Just update selection classes (only in icon mode when window list unchanged)
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
  } catch (e) {
    ok = false;
    error = String(e);
    throw e;
  } finally {
    mark.end(ok, error);
  }
}

// ============================================================================
// State Machine Transitions
// ============================================================================

// Check if Alt modifier is currently pressed
function isAltPressed(): boolean {
  const display = Gdk.Display.get_default();
  if (!display) return false;

  const seat = display.get_default_seat();
  if (!seat) return false;

  const device = seat.get_keyboard();
  if (!device) return false;

  const modifiers = device.get_modifier_state();
  return (modifiers & Gdk.ModifierType.ALT_MASK) !== 0;
}

// Transition to ACTIVE state
function enterActiveState(windows: WindowInfo[], index: number) {
  console.log(
    `[State] IDLE -> ACTIVE (${windows.length} windows, index ${index})`,
  );
  state = SwitcherState.ACTIVE;
  currentWindows = windows;
  currentIndex = index;
  isVisible = true;

  if (win) {
    updateSwitcher();
    win.set_visible(true);

    // Safety check: if Alt was already released before window became visible,
    // commit immediately. This handles the "quick Alt+Tab" edge case.
    GLib.timeout_add(GLib.PRIORITY_HIGH, 33, () => {
      if (state === SwitcherState.ACTIVE && !isAltPressed()) {
        console.log("Alt already released, committing immediately");
        onCommit();
      }
      return GLib.SOURCE_REMOVE;
    });
  }
}

// Transition to IDLE state
function enterIdleState() {
  console.log(`[State] ${state} -> IDLE`);
  state = SwitcherState.IDLE;
  isVisible = false;

  if (win) {
    win.set_visible(false);
  }
}

// ============================================================================
// Event Handlers
// ============================================================================

// Handle next window event
function onNext() {
  if (state === SwitcherState.IDLE) {
    // Fetch windows and initialize
    const windows = getWindows();

    if (windows.length === 0) return;
    if (windows.length === 1) return;

    // Update focus history with currently active window before switching
    const activeAddress = getActiveWindowAddress();
    if (activeAddress) {
      updateFocusHistory(activeAddress);
    }

    let index: number;
    
    if (sortMode === SortMode.RECENCY) {
      // In recency mode, start at index 1 (second most recent window)
      // This gives Windows-like Alt+Tab behavior
      index = 1;
    } else {
      // In alphabetical mode, find current window and cycle to next
      index = windows.findIndex((w) => w.address === activeAddress);
      
      // If current window not found, start from first
      if (index === -1) {
        index = 0;
      }
      
      // Cycle to next
      index = (index + 1) % windows.length;
    }

    enterActiveState(windows, index);
  } else if (state === SwitcherState.ACTIVE) {
    // Cycle within current session
    if (currentWindows.length === 0) return;
    if (currentWindows.length === 1) return;

    currentIndex = (currentIndex + 1) % currentWindows.length;
    updateSwitcher();
  }
}

// Handle previous window event
function onPrev() {
  if (state === SwitcherState.IDLE) {
    // Fetch windows and initialize
    const windows = getWindows();

    if (windows.length === 0) return;
    if (windows.length === 1) return;

    // Update focus history with currently active window before switching
    const activeAddress = getActiveWindowAddress();
    if (activeAddress) {
      updateFocusHistory(activeAddress);
    }

    let index: number;
    
    if (sortMode === SortMode.RECENCY) {
      // In recency mode, Shift+Tab should go to second most recent (same as Tab)
      // This matches Windows behavior where first Shift+Tab goes to same place as Tab
      index = 1;
    } else {
      // In alphabetical mode, find current window and cycle to previous
      index = windows.findIndex((w) => w.address === activeAddress);
      
      // If current window not found, start from last
      if (index === -1) {
        index = windows.length - 1;
      }
      
      // Cycle to previous
      index = (index - 1 + windows.length) % windows.length;
    }

    enterActiveState(windows, index);
  } else if (state === SwitcherState.ACTIVE) {
    // Cycle within current session
    if (currentWindows.length === 0) return;
    if (currentWindows.length === 1) return;

    currentIndex =
      (currentIndex - 1 + currentWindows.length) % currentWindows.length;
    updateSwitcher();
  }
}

// Handle commit and hide
function onCommit() {
  if (state !== SwitcherState.ACTIVE) {
    enterIdleState();
    return;
  }

  if (currentWindows.length === 0) {
    enterIdleState();
    return;
  }

  const targetWindow = currentWindows[currentIndex];
  if (!targetWindow) {
    enterIdleState();
    return;
  }

  try {
    GLib.spawn_command_line_async(
      `hyprctl dispatch focuswindow address:${targetWindow.address}`,
    );
    
    // Update focus history when committing a switch
    updateFocusHistory(targetWindow.address);
  } catch (e) {
    console.error("Error focusing window:", e);
  }

  enterIdleState();
}

// Handle hide without commit
function onHide() {
  enterIdleState();
}

// Handle Alt key release
function onAltRelease() {
  if (state !== SwitcherState.ACTIVE) return;
  console.log("Alt key released, committing switch");
  onCommit();
}

// ============================================================================
// Legacy function wrappers (for compatibility during transition)
// ============================================================================

function commitSwitch() {
  onCommit();
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
      // Check if Alt key was released
      // Alt_L = 65513 (0xffe9), Alt_R = 65514 (0xffea)
      if (keyval === 65513 || keyval === 65514) {
        onAltRelease();
      }
      
      // Handle Print key for screenshots (Print = 0xff61 = 65377)
      if (keyval === 65377) {
        try {
          GLib.spawn_command_line_async("bash ~/.config/hypr/scripts/screenshot.sh screen");
          console.log("Screenshot triggered from window-switcher");
        } catch (e) {
          console.error("Failed to trigger screenshot:", e);
        }
      }
    },
  );

  win.add_controller(controller);
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
      application={app}
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
          {/* Apps container - can have multiple rows */}
          <box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={8}
            halign={Gtk.Align.CENTER}
            class="apps-container"
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
  
  window.window-switcher box.switcher-container {
    background-color: rgba(25, 25, 25, 0.5);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 18px;
    padding: 24px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2),
                0 0 0 1px rgba(255, 255, 255, 0.05) inset;
  }
  
  window.window-switcher box.apps-container {
    /* Container for potentially multiple rows */
  }
  
  window.window-switcher box.apps-row {
    min-height: ${ICON_SIZE + 16}px;
  }
  
  window.window-switcher button.app-button {
    padding: 8px;
    border-radius: 12px;
    border: 2px solid transparent;
    background-color: transparent;
    transition: all 150ms ease;
  }
  
  window.window-switcher button.app-button:hover {
    background-color: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.2);
  }
  
  window.window-switcher button.app-button.selected {
    background-color: rgba(55, 55, 55, 0.7);
    border-color: ${tokens.colors.accent.active.value};
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2),
                0 0 0 1px ${tokens.colors.accent.active.value}33 inset;
  }
  
  window.window-switcher button.app-button.selected:hover {
    background-color: rgba(65, 65, 65, 0.8);
    border-color: ${tokens.colors.accent.active.value};
  }
  
  window.window-switcher box.icon-container {
    min-width: ${ICON_SIZE}px;
    min-height: ${ICON_SIZE}px;
    border-radius: 12px;
  }
  
  window.window-switcher box.icon-container.letter-icon {
    background-color: ${tokens.colors.accent.primary.value};
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }
  
  window.window-switcher image.app-icon-image {
    min-width: ${ICON_SIZE}px;
    min-height: ${ICON_SIZE}px;
  }
  
  window.window-switcher label.app-icon-letter {
    font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
    font-weight: 600;
    font-size: 28px;
    color: ${tokens.colors.foreground.primary.value};
    min-width: ${ICON_SIZE}px;
    min-height: ${ICON_SIZE}px;
  }
  
  window.window-switcher label.app-name {
    font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
    font-size: 14px;
    color: ${tokens.colors.foreground.primary.value};
    max-width: 600px;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }
  
  /* Preview mode styles */
  window.window-switcher box.window-preview {
    background-color: rgba(30, 30, 30, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3),
                0 0 0 1px rgba(255, 255, 255, 0.05) inset;
  }
  
  window.window-switcher box.preview-header {
    background-color: rgba(40, 40, 40, 0.95);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px 8px 0 0;
    padding: 8px 12px;
    box-sizing: border-box;
  }
  
  window.window-switcher image.preview-header-icon {
    min-width: 20px;
    min-height: 20px;
  }
  
  window.window-switcher box.preview-header-icon-fallback {
    min-width: 20px;
    min-height: 20px;
    border-radius: 4px;
    background-color: ${tokens.colors.accent.primary.value};
  }
  
  window.window-switcher label.preview-header-letter {
    font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
    font-weight: 600;
    font-size: 12px;
    color: ${tokens.colors.foreground.primary.value};
  }
  
  window.window-switcher label.preview-header-title {
    font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    color: ${tokens.colors.foreground.primary.value};
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  window.window-switcher box.preview-body {
    background: linear-gradient(135deg, rgba(40, 40, 40, 0.9) 0%, rgba(25, 25, 25, 0.9) 100%);
    overflow: hidden;
  }
  
  window.window-switcher picture.preview-image {
    min-width: 100%;
    min-height: 100%;
    border-radius: 0 0 8px 8px;
  }
  `,
  false,
);

// Helper functions for request handler
function handleShowAction() {
  // Window is pre-created at init for Alt monitoring
  const windows = getWindows();
  if (windows.length <= 1) {
    return;
  }

  const activeAddress = getActiveWindowAddress();
  let index = windows.findIndex((w) => w.address === activeAddress);
  index = index === -1 ? 0 : index;

  enterActiveState(windows, index);
}

function handleSetMode(mode: string | undefined): string {
  const normalizedMode = mode?.toUpperCase();

  if (normalizedMode !== "ICONS" && normalizedMode !== "PREVIEWS") {
    return "invalid mode, use 'icons' or 'previews'";
  }

  displayMode =
    normalizedMode === "ICONS" ? DisplayMode.ICONS : DisplayMode.PREVIEWS;
  rebuildUIIfActive();

  return `mode set to ${normalizedMode}`;
}

function handleToggleMode() {
  displayMode =
    displayMode === DisplayMode.ICONS
      ? DisplayMode.PREVIEWS
      : DisplayMode.ICONS;
  rebuildUIIfActive();
}

function handleSetSortMode(mode: string | undefined): string {
  const normalizedMode = mode?.toUpperCase();

  if (normalizedMode !== "ALPHABETICAL" && normalizedMode !== "RECENCY") {
    return "invalid sort mode, use 'alphabetical' or 'recency'";
  }

  sortMode =
    normalizedMode === "ALPHABETICAL" ? SortMode.ALPHABETICAL : SortMode.RECENCY;
  
  // If active, refresh window list with new sort order
  if (state === SwitcherState.ACTIVE) {
    const windows = getWindows();
    currentWindows = windows;
    currentIndex = 0; // Reset to first window with new sort
    previousWindowAddresses = [];
    windowButtons.clear();
    updateSwitcher();
  }

  return `sort mode set to ${normalizedMode}`;
}

function rebuildUIIfActive() {
  if (state === SwitcherState.ACTIVE) {
    // Force rebuild by clearing previous addresses
    previousWindowAddresses = [];
    windowButtons.clear();
    updateSwitcher();
  }
}

// Functions for bundled mode (using global namespace pattern)
function initWindowSwitcher() {
  // Window-switcher needs to be created immediately for Alt monitoring to work
  // This is the only component that can't be lazy-loaded due to its Alt key event handling
  createWindow();
}

function handleWindowSwitcherRequest(argv: string[], res: (response: string) => void) {
  const mark = perf.start("window-switcher", "handleRequest");
  let ok = true;
  let error: string | undefined;
  try {
    const request = argv.join(" ");

    if (!request || request.trim() === "") {
      res("ready");
      return;
    }

    const data = JSON.parse(request);
    const action = data.action;

    if (action === "show") {
      handleShowAction();
      res("shown");
      return;
    }

    if (action === "next") {
      onNext();
      res("cycled next");
      return;
    }

    if (action === "prev") {
      onPrev();
      res("cycled prev");
      return;
    }

    if (action === "commit") {
      onCommit();
      res("committed");
      return;
    }

    if (action === "hide") {
      onHide();
      res("hidden");
      return;
    }

    if (action === "set-mode") {
      const response = handleSetMode(data.mode);
      res(response);
      return;
    }

    if (action === "toggle-mode") {
      handleToggleMode();
      res(`mode toggled to ${displayMode}`);
      return;
    }

    if (action === "set-sort-mode") {
      const response = handleSetSortMode(data.mode);
      res(response);
      return;
    }

    if (action === "get-sort-mode") {
      res(`current sort mode: ${sortMode}`);
      return;
    }

    if (action === "get-mode") {
      res(`current mode: ${displayMode}`);
      return;
    }

    if (action === "get-visibility") {
      res(isVisible ? "visible" : "hidden");
      return;
    }

    res("unknown action");
  } catch (e) {
    ok = false;
    error = String(e);
    console.error("Error handling window-switcher request:", e);
    res(`error: ${e}`);
  } finally {
    mark.end(ok, error);
  }
}

// Make component available globally
globalThis.WindowSwitcher = {
  init: initWindowSwitcher,
  handleRequest: handleWindowSwitcherRequest,
  instanceName: "window-switcher"
};
