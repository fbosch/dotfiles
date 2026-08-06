import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import type Gtk from 'gi://Gtk?version=4.0';
import app from 'ags/gtk4/app';

const runtimeDir = GLib.getenv('XDG_RUNTIME_DIR') || GLib.get_tmp_dir();
const profileStateDir = `${runtimeDir}/hypr-profiles`;
const profileModePath = `${profileStateDir}/profile-overlay.mode`;
const boundWidgets = new Set<Gtk.Widget>();

let gamingActive = readGamingState();
let monitor: Gio.FileMonitor | null = null;
let refreshTimer: number | null = null;
let stylesApplied = false;

function readGamingState(): boolean {
  try {
    const [success, contents] = GLib.file_get_contents(profileModePath);
    return success && new TextDecoder('utf-8').decode(contents).trim() === 'gaming';
  } catch {
    return false;
  }
}

function applyState(widget: Gtk.Widget): void {
  if (gamingActive) {
    widget.add_css_class('gaming-opaque');
    return;
  }

  widget.remove_css_class('gaming-opaque');
}

function refreshState(): void {
  const nextGamingActive = readGamingState();
  if (nextGamingActive === gamingActive) return;

  gamingActive = nextGamingActive;
  for (const widget of boundWidgets) {
    applyState(widget);
  }
}

function queueRefresh(): void {
  if (refreshTimer !== null) {
    GLib.source_remove(refreshTimer);
  }

  refreshTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 75, () => {
    refreshTimer = null;
    refreshState();
    return GLib.SOURCE_REMOVE;
  });
}

function startMonitor(): void {
  if (monitor) return;

  try {
    GLib.mkdir_with_parents(profileStateDir, 0o700);
    const dir = Gio.File.new_for_path(profileStateDir);
    monitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
    monitor.connect('changed', (_monitor, file) => {
      if (file.get_basename() === 'profile-overlay.mode') {
        queueRefresh();
      }
    });
  } catch (error) {
    console.error('Failed to monitor Gaming opacity state:', error);
  }
}

function applyStyles(): void {
  if (stylesApplied) return;
  stylesApplied = true;

  app.apply_css(
    `
      window.start-menu.gaming-opaque box.start-menu-container,
      window.start-menu.gaming-opaque box.recent-items-menu,
      window.calendar-widget.gaming-opaque box.calendar-container,
      window.audio-mixer-widget.gaming-opaque box.audio-mixer-container,
      window.force-quit.gaming-opaque box.force-quit-container,
      window.about-this-pc.gaming-opaque box.about-container,
      window.confirm-dialog.gaming-opaque box.dialog-box {
        background-color: rgb(45, 45, 45);
      }

      window.keyboard-layout-switcher.gaming-opaque box.keyboard-switcher-container,
      window.volume-indicator.gaming-opaque box.indicator-container {
        background-color: rgb(55, 55, 55);
      }

      window.desktop-clock.gaming-opaque box.clock-container {
        background-color: rgb(0, 0, 0);
      }

    `,
    false
  );
}

export function bindGamingOpacity(widget: Gtk.Widget): void {
  applyStyles();
  startMonitor();
  boundWidgets.add(widget);
  applyState(widget);
}
