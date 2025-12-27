import { Astal } from "ags/gtk4";
import app from "ags/gtk4/app";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import Gdk from "gi://Gdk?version=4.0";

// Clock configuration
interface ClockConfig {
  format24h?: boolean; // Use 24-hour format (default: true)
  showSeconds?: boolean; // Show seconds (default: true)
  showDate?: boolean; // Show date below time (default: false)
  monitor?: number | string; // Monitor ID (number) or name (string, e.g., "HDMI-A-2")
}

let win: Astal.Window | null = null;
let timeLabel: Gtk.Label | null = null;
let dateLabel: Gtk.Label | null = null;
let updateIntervalId: number | null = null;
let config: ClockConfig = {
  format24h: true,
  showSeconds: true,
  showDate: false,
  monitor: "HDMI-A-2", // Default to HDMI display
};

// Cached monitor reference to avoid repeated GDK lookups
let cachedMonitor: Gdk.Monitor | null = null;
let cachedMonitorKey: string | number | undefined = undefined;

// Cached date formatter to avoid recreating Intl.DateTimeFormat
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

// Cached time parts to avoid unnecessary updates
let lastTimeString: string = "";
let lastDateString: string = "";

// Format time string
function formatTime(): string {
  const now = new Date();
  
  if (config.format24h) {
    // 24-hour format
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    
    if (config.showSeconds) {
      const seconds = String(now.getSeconds()).padStart(2, '0');
      return `${hours}:${minutes}:${seconds}`;
    }
    return `${hours}:${minutes}`;
  } else {
    // 12-hour format with AM/PM
    let hours = now.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const minutes = String(now.getMinutes()).padStart(2, '0');
    
    if (config.showSeconds) {
      const seconds = String(now.getSeconds()).padStart(2, '0');
      return `${hours}:${minutes}:${seconds} ${ampm}`;
    }
    return `${hours}:${minutes} ${ampm}`;
  }
}

// Format date string
function formatDate(): string {
  const now = new Date();
  return dateFormatter.format(now);
}

// Get GdkMonitor from config (with caching)
function getMonitor(): Gdk.Monitor | null {
  // Return cached monitor if config hasn't changed
  if (cachedMonitor && cachedMonitorKey === config.monitor) {
    return cachedMonitor;
  }

  const display = Gdk.Display.get_default();
  if (!display) {
    console.error("[desktop-clock] No default display found");
    cachedMonitor = null;
    cachedMonitorKey = undefined;
    return null;
  }

  const monitors = display.get_monitors();
  const nMonitors = monitors.get_n_items();

  let monitor: Gdk.Monitor | null = null;

  // If monitor is a number, use it as index
  if (typeof config.monitor === 'number') {
    if (config.monitor >= 0 && config.monitor < nMonitors) {
      monitor = monitors.get_item(config.monitor) as Gdk.Monitor;
    } else {
      console.error(`[desktop-clock] Monitor index ${config.monitor} out of range (0-${nMonitors - 1})`);
    }
  }
  // If monitor is a string, find by connector name
  else if (typeof config.monitor === 'string') {
    for (let i = 0; i < nMonitors; i++) {
      const m = monitors.get_item(i) as Gdk.Monitor;
      const connector = m.get_connector();
      if (connector === config.monitor) {
        monitor = m;
        break;
      }
    }
    if (!monitor) {
      console.error(`[desktop-clock] Monitor "${config.monitor}" not found`);
      console.error(`[desktop-clock] Available monitors: ${Array.from({ length: nMonitors }, (_, i) => {
        const m = monitors.get_item(i) as Gdk.Monitor;
        return m.get_connector();
      }).join(', ')}`);
    }
  }
  // Default to first monitor
  else {
    monitor = monitors.get_item(0) as Gdk.Monitor;
  }

  // Cache the result
  cachedMonitor = monitor;
  cachedMonitorKey = config.monitor;
  
  return monitor;
}

// Update clock display (only if changed)
function updateClock() {
  const timeString = formatTime();
  
  // Only update if time actually changed
  if (timeLabel && timeString !== lastTimeString) {
    timeLabel.set_label(timeString);
    lastTimeString = timeString;
  }
  
  // Only update date if shown and changed
  if (dateLabel && config.showDate) {
    const dateString = formatDate();
    if (dateString !== lastDateString) {
      dateLabel.set_label(dateString);
      lastDateString = dateString;
    }
  }
}

// Start the clock update interval
function startClockUpdates() {
  if (updateIntervalId !== null) {
    GLib.source_remove(updateIntervalId);
  }
  
  // Update immediately
  updateClock();
  
  if (config.showSeconds) {
    // For seconds mode: align to the next second boundary
    const now = new Date();
    const msUntilNextSecond = 1000 - now.getMilliseconds();
    
    // Schedule first update at next second boundary
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, msUntilNextSecond, () => {
      updateClock();
      
      // Then start regular 1-second interval
      updateIntervalId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        updateClock();
        return true;
      });
      
      return false; // Don't repeat this initial timeout
    });
  } else {
    // For minute mode: align to the next minute boundary
    const now = new Date();
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    
    // Schedule first update at next minute boundary
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, msUntilNextMinute, () => {
      updateClock();
      
      // Then start regular 1-minute interval
      updateIntervalId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60000, () => {
        updateClock();
        return true;
      });
      
      return false; // Don't repeat this initial timeout
    });
  }
}

// Stop clock updates
function stopClockUpdates() {
  if (updateIntervalId !== null) {
    GLib.source_remove(updateIntervalId);
    updateIntervalId = null;
  }
}

// Apply CSS styling
function applyCSS() {
  app.apply_css(
    `
    window.desktop-clock {
      background-color: transparent;
      border: none;
    }
    
    window.desktop-clock box.clock-container {
      padding: 20px 24px;
      background-color: rgba(25, 25, 25, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
    }
    
    window.desktop-clock label.time-label {
      font-family: "JetBrains Mono", monospace;
      font-size: 48px;
      font-weight: 700;
      color: rgba(255, 255, 255, 0.95);
      text-shadow: 2px 2px 8px rgba(0, 0, 0, 0.5);
    }
    
    window.desktop-clock label.date-label {
      font-family: system-ui, sans-serif;
      font-size: 16px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.7);
      margin-top: 8px;
    }
  `,
    false,
  );
}

// Create the clock window
function createWindow() {
  if (win) {
    return; // Window already exists
  }

  win = new Astal.Window({
    name: "desktop-clock",
    namespace: "ags-desktop-clock",
    visible: true,
  });

  win.set_anchor(Astal.WindowAnchor.TOP | Astal.WindowAnchor.RIGHT);
  win.set_layer(Astal.Layer.BACKGROUND);
  win.set_exclusivity(Astal.Exclusivity.NORMAL);
  win.set_keymode(Astal.Keymode.NONE);
  win.add_css_class("desktop-clock");

  // Set monitor if specified
  const monitor = getMonitor();
  if (monitor) {
    win.set_gdkmonitor(monitor);
    console.log(`[desktop-clock] Using monitor: ${monitor.get_connector()}`);
  } else {
    console.warn("[desktop-clock] Using default monitor");
  }

  // Create container
  const container = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    halign: Gtk.Align.END,
    valign: Gtk.Align.START,
  });
  container.add_css_class("clock-container");

  // Create time label
  timeLabel = new Gtk.Label({
    label: formatTime(),
    halign: Gtk.Align.CENTER,
  });
  timeLabel.add_css_class("time-label");
  container.append(timeLabel);

  // Create date label (conditionally shown)
  if (config.showDate) {
    dateLabel = new Gtk.Label({
      label: formatDate(),
      halign: Gtk.Align.CENTER,
    });
    dateLabel.add_css_class("date-label");
    container.append(dateLabel);
  }

  win.set_child(container);
  win.set_margin_top(20);
  win.set_margin_end(20);

  // Start updates
  startClockUpdates();
}

// Destroy the clock window
function destroyWindow() {
  stopClockUpdates();
  
  if (win) {
    win.destroy();
    win = null;
  }
  
  timeLabel = null;
  dateLabel = null;
}

// Update configuration
function updateConfig(newConfig: Partial<ClockConfig>) {
  const needsRecreate = 
    (newConfig.showDate !== undefined && newConfig.showDate !== config.showDate) ||
    (newConfig.monitor !== undefined && newConfig.monitor !== config.monitor);
  
  config = { ...config, ...newConfig };
  
  // Invalidate monitor cache if monitor changed
  if (newConfig.monitor !== undefined) {
    cachedMonitorKey = undefined;
    cachedMonitor = null;
  }
  
  if (needsRecreate && win) {
    // Recreate window if date visibility or monitor changed
    destroyWindow();
    createWindow();
  } else if (win) {
    // Just update the display and interval
    stopClockUpdates();
    startClockUpdates();
  }
}

// Functions for bundled mode (using global namespace pattern)
function initDesktopClock() {
  applyCSS();
  createWindow();
}

function handleDesktopClockRequest(argv: string[], res: (response: string) => void) {
  try {
    const request = argv.join(" ");

    if (!request || request.trim() === "") {
      res("ok");
      return;
    }

    const data = JSON.parse(request);

    if (data.action === "show") {
      if (!win) {
        createWindow();
      }
      res("shown");
    } else if (data.action === "hide") {
      destroyWindow();
      res("hidden");
    } else if (data.action === "config") {
      updateConfig(data.config || {});
      res("config updated");
    } else if (data.action === "get-visibility") {
      res(win ? "visible" : "hidden");
    } else {
      res("unknown action");
    }
  } catch (e) {
    console.error("Error handling desktop-clock request:", e);
    res(`error: ${e}`);
  }
}

// Make component available globally
globalThis.DesktopClock = {
  init: initDesktopClock,
  handleRequest: handleDesktopClockRequest,
  instanceName: "desktop-clock"
};
