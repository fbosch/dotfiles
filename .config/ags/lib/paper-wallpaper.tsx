import { Astal } from "ags/gtk4";
import GLib from "gi://GLib?version=2.0";
import Gdk from "gi://Gdk?version=4.0";
import WebKit from "gi://WebKit?version=6.0";

const targetMonitor = "DP-2";
const hyprpaperConfigPath = `${GLib.get_home_dir()}/.config/hypr/hyprpaper.conf`;
const pagePath = `${GLib.get_home_dir()}/.config/ags/wallpaper/index.html`;

let window: Astal.Window | null = null;

function readDp2WallpaperPath(): string {
  const [success, contents] = GLib.file_get_contents(hyprpaperConfigPath);
  if (!success || !contents) {
    throw new Error(`Could not read ${hyprpaperConfigPath}`);
  }

  for (const match of new TextDecoder("utf-8").decode(contents).matchAll(/wallpaper\s*\{([^}]*)\}/gs)) {
    const assignment = match[1];
    const monitor = assignment.match(/^\s*monitor\s*=\s*(.+?)\s*$/m)?.[1];
    const path = assignment.match(/^\s*path\s*=\s*(.+?)\s*$/m)?.[1];

    if (monitor === targetMonitor && path) {
      return path;
    }
  }

  throw new Error(`No wallpaper assignment for ${targetMonitor} in ${hyprpaperConfigPath}`);
}

function getDp2Monitor(): Gdk.Monitor {
  const display = Gdk.Display.get_default();
  if (!display) {
    throw new Error("No GDK display available");
  }

  const monitors = display.get_monitors();
  for (let index = 0; index < monitors.get_n_items(); index += 1) {
    const monitor = monitors.get_item(index) as Gdk.Monitor;
    if (monitor.get_connector() === targetMonitor) {
      return monitor;
    }
  }

  throw new Error(`${targetMonitor} is not connected`);
}

function createWindow() {
  if (window) {
    return;
  }

  const wallpaperUri = GLib.filename_to_uri(readDp2WallpaperPath(), null);
  const pageUri = GLib.filename_to_uri(pagePath, null);
  const settings = new WebKit.Settings({
    allow_file_access_from_file_urls: true,
  });
  const webView = new WebKit.WebView({ settings });

  webView.set_can_focus(false);
  webView.set_sensitive(false);
  webView.connect("load-failed", (_view, _event, uri, error) => {
    console.error(`[paper-wallpaper] Could not load ${uri}: ${error.message}`);
    return false;
  });
  webView.load_uri(`${pageUri}?wallpaper=${encodeURIComponent(wallpaperUri)}`);

  window = new Astal.Window({
    name: "paper-wallpaper",
    namespace: "ags-paper-wallpaper",
    visible: true,
  });
  window.set_anchor(
    Astal.WindowAnchor.TOP |
      Astal.WindowAnchor.BOTTOM |
      Astal.WindowAnchor.LEFT |
      Astal.WindowAnchor.RIGHT,
  );
  window.set_layer(Astal.Layer.BACKGROUND);
  window.set_exclusivity(Astal.Exclusivity.IGNORE);
  window.set_keymode(Astal.Keymode.NONE);
  window.set_gdkmonitor(getDp2Monitor());
  window.set_child(webView);
}

function initPaperWallpaper() {
  createWindow();
}

function handlePaperWallpaperRequest(_argv: string[], res: (response: string) => void) {
  res("no actions");
}

globalThis.PaperWallpaper = {
  init: initPaperWallpaper,
  handleRequest: handlePaperWallpaperRequest,
  instanceName: "paper-wallpaper",
};
