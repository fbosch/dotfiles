import { Astal } from "ags/gtk4";
import app from "ags/gtk4/app";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";

// Size configuration matching design-system component
const size = {
  containerPadding: "6px 12px", // py-1.5 px-3
  iconSize: 20,
  squareSize: 8,
  squareGap: 2,
  fontSize: 12,
  topMargin: 20, // margin from top of screen
};

type SpeakerState =
  | "muted"
  | "verylow"
  | "low"
  | "medium"
  | "high"
  | "veryhigh";

// Segoe Fluent Icons glyphs for volume levels
const speakerIcons: Record<SpeakerState, string> = {
  muted: "", // Muted/Volume 0
  verylow: "", // Very low volume
  low: "", // Low volume
  medium: "", // Medium volume
  high: "", // High volume
  veryhigh: "", // Very high volume
};

function getSpeakerState(volume: number, muted: boolean): SpeakerState {
  if (muted) return "muted";
  if (volume === 0) return "muted";
  if (volume <= 15) return "verylow";
  if (volume <= 25) return "low";
  if (volume <= 50) return "medium";
  if (volume <= 75) return "high";
  return "veryhigh";
}

// Get current volume and mute status from wpctl
function getVolumeInfo(): { volume: number; muted: boolean } {
  try {
    // Get volume for default audio sink (@DEFAULT_AUDIO_SINK@)
    const [ok, stdout, stderr, exit_status] = GLib.spawn_command_line_sync(
      "wpctl get-volume @DEFAULT_AUDIO_SINK@",
    );

    if (!ok || exit_status !== 0) {
      return { volume: 0, muted: false };
    }

    const volumeText = new TextDecoder().decode(stdout);

    // Parse output like "Volume: 0.50" or "Volume: 0.50 [MUTED]"
    const volumeMatch = volumeText.match(/Volume:\s+([\d.]+)/);
    const volume = volumeMatch
      ? Math.round(parseFloat(volumeMatch[1]) * 100)
      : 0;
    const muted = volumeText.includes("[MUTED]");

    return { volume, muted };
  } catch (e) {
    console.error("Failed to get volume info:", e);
    return { volume: 0, muted: false };
  }
}

// Apply static CSS
app.apply_css(
  `
  window.volume-indicator {
    background-color: transparent;
    border: none;
  }
  
  box.shadow-wrapper {
    padding: 40px;
    opacity: 0;
    transition: opacity 100ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  
  box.shadow-wrapper.visible {
    opacity: 1;
  }
  
  box.shadow-wrapper.hiding {
    opacity: 0;
    transition: opacity 50ms cubic-bezier(0.4, 0, 1, 1);
  }
  
  box.indicator-container {
    background-color: rgba(55, 55, 55, 0.80);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 9999px;
    padding: ${size.containerPadding};
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  }
  
  box.icon-container {
    min-width: ${size.iconSize}px;
    min-height: ${size.iconSize}px;
    margin-right: 12px;
  }
  
  label.speaker-icon {
    font-family: "Segoe Fluent Icons";
    font-size: ${size.iconSize}px;
    color: white;
  }
  
  label.speaker-icon.muted {
    color: rgba(255, 255, 255, 0.5);
  }
  
  box.progress-container {
    margin-right: 12px;
    min-height: ${size.squareSize}px;
    max-height: ${size.squareSize}px;
  }
  
  box.progress-square {
    min-width: ${size.squareSize}px;
    min-height: ${size.squareSize}px;
    max-width: ${size.squareSize}px;
    max-height: ${size.squareSize}px;
    border-radius: 2px;
    transition: background-color 150ms ease;
  }
  
  box.progress-square.filled {
    background-color: white;
  }
  
  box.progress-square.empty {
    background-color: rgba(255, 255, 255, 0.2);
  }
  
  label.volume-label {
    font-family: system-ui, sans-serif;
    font-weight: 700;
    font-size: ${size.fontSize}px;
    color: white;
    min-width: 42px;
  }
  
  label.volume-label.muted {
    color: rgba(255, 255, 255, 0.5);
  }
`,
  false,
);

let win: Astal.Window | null = null;
let shadowWrapper: Gtk.Box | null = null;
let hideTimeout: number | null = null;
let progressSquares: Gtk.Box[] = [];
let iconLabel: Gtk.Label | null = null;
let volumeLabel: Gtk.Label | null = null;
let isVisible = false;

function update() {
  if (!iconLabel || !volumeLabel) return;

  const { volume, muted } = getVolumeInfo();
  const speakerState = getSpeakerState(volume, muted);

  // Update icon
  iconLabel.set_label(speakerIcons[speakerState]);
  if (speakerState === "muted") {
    iconLabel.add_css_class("muted");
  } else {
    iconLabel.remove_css_class("muted");
  }

  // Update volume label
  volumeLabel.set_label(muted ? "Muted" : `${volume}%`);
  if (muted || volume === 0) {
    volumeLabel.add_css_class("muted");
  } else {
    volumeLabel.remove_css_class("muted");
  }

  // Update progress squares
  const filledCount = muted ? 0 : Math.round((volume / 100) * 16);
  for (let i = 0; i < progressSquares.length; i++) {
    if (i < filledCount) {
      progressSquares[i].add_css_class("filled");
      progressSquares[i].remove_css_class("empty");
    } else {
      progressSquares[i].remove_css_class("filled");
      progressSquares[i].add_css_class("empty");
    }
  }
}

function hideIndicator() {
  if (!isVisible || !win || !shadowWrapper) {
    return;
  }

  // Cancel any pending hide timeout
  if (hideTimeout !== null) {
    GLib.source_remove(hideTimeout);
    hideTimeout = null;
  }

  // Start fade out animation
  shadowWrapper.remove_css_class("visible");
  shadowWrapper.add_css_class("hiding");

  // Hide window after fade out completes
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

function showIndicator() {
  if (!win || !shadowWrapper) return;

  // Update volume info before showing
  update();

  // Show window if not visible
  if (!isVisible) {
    win.set_visible(true);
    isVisible = true;

    // Trigger fade in animation
    shadowWrapper.remove_css_class("hiding");
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      shadowWrapper?.add_css_class("visible");
      return false;
    });
  }

  // Reset auto-hide timer
  if (hideTimeout !== null) {
    GLib.source_remove(hideTimeout);
  }

  // Auto-hide after 1.5 seconds
  hideTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
    hideIndicator();
    hideTimeout = null;
    return false;
  });
}

function createWindow() {
  win = new Astal.Window({
    name: "volume-indicator",
    namespace: "ags-volume-indicator",
    visible: false,
  });

  win.set_anchor(Astal.WindowAnchor.NONE);
  win.set_layer(Astal.Layer.OVERLAY);
  win.set_exclusivity(Astal.Exclusivity.NORMAL);
  win.set_keymode(Astal.Keymode.NONE);
  win.add_css_class("volume-indicator");

  shadowWrapper = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER,
  });
  shadowWrapper.add_css_class("shadow-wrapper");

  const indicatorContainer = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 0,
  });
  indicatorContainer.add_css_class("indicator-container");

  // Icon container
  const iconContainer = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER,
  });
  iconContainer.add_css_class("icon-container");

  iconLabel = new Gtk.Label({ label: "" });
  iconLabel.add_css_class("speaker-icon");
  iconContainer.append(iconLabel);

  // Progress squares container
  const progressContainer = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: size.squareGap,
    valign: Gtk.Align.CENTER,
  });
  progressContainer.add_css_class("progress-container");

  progressSquares = [];
  for (let i = 0; i < 16; i++) {
    const square = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      hexpand: false,
      vexpand: false,
      halign: Gtk.Align.CENTER,
      valign: Gtk.Align.CENTER,
    });
    square.add_css_class("progress-square");
    square.add_css_class("empty");
    progressSquares.push(square);
    progressContainer.append(square);
  }

  // Volume label
  volumeLabel = new Gtk.Label({ label: "0%" });
  volumeLabel.add_css_class("volume-label");

  // Assemble
  indicatorContainer.append(iconContainer);
  indicatorContainer.append(progressContainer);
  indicatorContainer.append(volumeLabel);
  shadowWrapper.append(indicatorContainer);
  win.set_child(shadowWrapper);

  // Initial update
  update();
}

// IPC to receive show/hide commands via AGS messaging
app.start({
  main() {
    createWindow();
    return null;
  },
  instanceName: "volume-indicator-daemon",
  requestHandler(argv: string[], res: (response: string) => void) {
    try {
      const request = argv.join(" ");
      const data = JSON.parse(request);

      if (data.action === "show") {
        showIndicator();
        res("shown");
      } else if (data.action === "hide") {
        hideIndicator();
        res("hidden");
      } else {
        res("unknown action");
      }
    } catch (e) {
      res(`error: ${e}`);
    }
  },
});
