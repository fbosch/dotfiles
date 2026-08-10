import { Astal } from "ags/gtk4";
import app from "ags/gtk4/app";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import tokens from "../../../design-system/tokens.json";

type PreviewRequest = {
  action?: string;
  monitor?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rounding?: number;
};

let win: Astal.Window | null = null;
let targetBox: Gtk.Box | null = null;
let previewRoot: Gtk.Fixed | null = null;
let isVisible = false;
let appliedRounding: number | null = null;
const previewBorderWidth = 2;

function monitorByConnector(connector: string): Gdk.Monitor | null {
  const display = Gdk.Display.get_default();
  if (!display) return null;

  const monitors = display.get_monitors();
  for (let index = 0; index < monitors.get_n_items(); index++) {
    const monitor = monitors.get_item(index) as Gdk.Monitor;
    if (monitor.get_connector() === connector) return monitor;
  }

  return null;
}

function createWindow(): void {
  if (win) return;

  targetBox = new Gtk.Box();
  targetBox.add_css_class("pip-snap-preview-target");
  previewRoot = new Gtk.Fixed();
  previewRoot.put(targetBox, 0, 0);

  win = new Astal.Window({
    name: "pip-snap-preview",
    namespace: "ags-pip-snap-preview",
    visible: false,
  });
  win.set_anchor(
    Astal.WindowAnchor.TOP |
      Astal.WindowAnchor.BOTTOM |
      Astal.WindowAnchor.LEFT |
      Astal.WindowAnchor.RIGHT,
  );
  win.set_layer(Astal.Layer.OVERLAY);
  win.set_exclusivity(Astal.Exclusivity.IGNORE);
  win.set_keymode(Astal.Keymode.NONE);
  win.set_can_target(false);
  win.add_css_class("pip-snap-preview");
  win.set_child(previewRoot);
}

function showPreview(data: PreviewRequest): string {
  if (
    typeof data.monitor !== "string" ||
    typeof data.x !== "number" ||
    typeof data.y !== "number" ||
    typeof data.width !== "number" ||
    typeof data.height !== "number" ||
    typeof data.rounding !== "number"
  ) {
    return "invalid preview geometry";
  }

  const monitor = monitorByConnector(data.monitor);
  if (!monitor) return `unknown monitor ${data.monitor}`;

  applyCss(data.rounding);
  createWindow();
  if (!win || !targetBox || !previewRoot) return "preview unavailable";

  targetBox.set_size_request(data.width, data.height);
  win.set_gdkmonitor(monitor);
  previewRoot.move(targetBox, data.x, data.y);
  win.set_visible(true);
  isVisible = true;
  return "shown";
}

function hidePreview(): string {
  win?.set_visible(false);
  isVisible = false;
  return "hidden";
}

function applyCss(rounding: number): void {
  if (rounding === appliedRounding) return;

  appliedRounding = rounding;
  app.apply_css(
    `
      window.pip-snap-preview {
        background-color: transparent;
      }

      window.pip-snap-preview box.pip-snap-preview-target {
        background-color: ${tokens.colors.accent.primary.value}29;
        border: ${previewBorderWidth}px solid ${tokens.colors.accent.active.value};
        border-radius: ${rounding + previewBorderWidth}px;
        box-shadow: 0 0 20px ${tokens.colors.accent.primary.value}57;
      }
    `,
    false,
  );
}

function initPipSnapPreview(): void {
  createWindow();
}

function handlePipSnapPreviewRequest(argv: string[], res: (response: string) => void): void {
  try {
    const data = JSON.parse(argv.join(" ")) as PreviewRequest;
    if (data.action === "show") {
      res(showPreview(data));
      return;
    }
    if (data.action === "hide") {
      res(hidePreview());
      return;
    }
    if (data.action === "is-visible") {
      res(isVisible ? "true" : "false");
      return;
    }

    res("unknown action");
  } catch (error) {
    console.error("Failed to handle PiP snap preview request:", error);
    res(`error: ${error}`);
  }
}

globalThis.PipSnapPreview = {
  init: initPipSnapPreview,
  handleRequest: handlePipSnapPreviewRequest,
  instanceName: "pip-snap-preview",
};
