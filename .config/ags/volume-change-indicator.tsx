import app from "ags/gtk4/app";
import { Astal } from "ags/gtk4";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import tokens from "../../design-system/tokens.json";

// Volume state interface
interface VolumeState {
  volume: number; // 0-100
  muted: boolean;
}

type SpeakerState =
  | "muted"
  | "verylow"
  | "low"
  | "medium"
  | "high"
  | "veryhigh";

// Size configuration matching design-system component
interface SizeConfig {
  containerPadding: string;
  iconSize: string;
  squareSize: string;
  squareGap: string;
  fontSize: string;
  labelMinWidth: string;
}

const sizes: Record<"sm" | "md" | "lg", SizeConfig> = {
  sm: {
    containerPadding: "12px 12px",
    iconSize: "20px",
    squareSize: "8px",
    squareGap: "2px",
    fontSize: "12px",
    labelMinWidth: "42px",
  },
  md: {
    containerPadding: "12px 12px",
    iconSize: "24px",
    squareSize: "10px",
    squareGap: "2px",
    fontSize: "16px",
    labelMinWidth: "48px",
  },
  lg: {
    containerPadding: "16px 16px",
    iconSize: "32px",
    squareSize: "12px",
    squareGap: "3px",
    fontSize: "18px",
    labelMinWidth: "56px",
  },
};

let win: Astal.Window | null = null;
let iconLabel: Gtk.Label | null = null;
let volumeLabel: Gtk.Label | null = null;
let progressSquares: Gtk.Box[] = [];
let isVisible: boolean = false;
let hideTimeoutId: number | null = null;
let currentSize: "sm" | "md" | "lg" = "sm";
let lastVolumeState: VolumeState = { volume: 0, muted: false };

// Segoe Fluent Icons glyphs for volume levels (matching design system)
const speakerIcons: Record<SpeakerState, string> = {
  muted: "", // Muted/Volume 0
  verylow: "", // Very low volume
  low: "", // Low volume
  medium: "", // Medium volume
  high: "", // High volume
  veryhigh: "", // Very high volume
};

/**
 * Determine speaker state based on volume level
 */
function getSpeakerState(volume: number, muted: boolean): SpeakerState {
  if (muted) return "muted";
  if (volume === 0) return "muted";
  if (volume <= 15) return "verylow";
  if (volume <= 25) return "low";
  if (volume <= 50) return "medium";
  if (volume <= 75) return "high";
  return "veryhigh";
}

// Apply static CSS once on module load
function applyStaticCSS() {
  app.apply_css(
    `
    /* Window container - transparent backdrop */
    window.volume-indicator {
      background-color: transparent;
      border: none;
    }
    
    /* Outer wrapper for shadow */
    box.shadow-wrapper {
      padding: 40px;
      opacity: 0;
      transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    box.shadow-wrapper.visible {
      opacity: 1;
    }
    
    box.shadow-wrapper.hiding {
      opacity: 0;
      transition: opacity 100ms cubic-bezier(0.4, 0, 1, 1);
    }
    
    /* Main container - macOS glass effect matching design system */
    /* bg-background-tertiary/80 border border-white/10 backdrop-blur-sm shadow-[0_4px_16px_rgba(0,0,0,0.3)] rounded-full */
    box.indicator-container {
      background-color: rgba(55, 55, 55, 0.80); /* background-tertiary */
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 9999px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    }
    
    /* Icon container */
    box.icon-container {
      margin-right: 12px;
    }
    
    label.speaker-icon {
      font-family: "Segoe Fluent Icons";
      color: ${tokens.colors.foreground.primary.value};
    }
    
    label.speaker-icon.muted {
      color: ${tokens.colors.foreground.tertiary.value};
    }
    
    /* Progress bar container */
    box.progress-container {
      margin-right: 12px;
    }
    
    /* Individual progress squares */
    box.progress-square {
      border-radius: 2px;
      transition: background-color 150ms ease;
    }
    
    box.progress-square.filled {
      background-color: ${tokens.colors.foreground.primary.value};
    }
    
    box.progress-square.empty {
      background-color: rgba(255, 255, 255, 0.2);
    }
    
    /* Volume label */
    label.volume-label {
      font-family: "${tokens.typography.fontFamily.button.value}", "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-weight: 700;
      color: ${tokens.colors.foreground.primary.value};
    }
    
    label.volume-label.muted {
      color: ${tokens.colors.foreground.tertiary.value};
    }
  `,
    false,
  );
}

// Apply static CSS on module load
applyStaticCSS();

// Update dynamic CSS based on size
function updateSizeCSS(size: "sm" | "md" | "lg") {
  if (currentSize === size) return;
  currentSize = size;

  const sizeConfig = sizes[size];

  app.apply_css(
    `
    box.indicator-container {
      padding: ${sizeConfig.containerPadding};
    }
    
    box.icon-container {
      min-width: ${sizeConfig.iconSize};
      min-height: ${sizeConfig.iconSize};
    }
    
    label.speaker-icon {
      font-size: ${sizeConfig.iconSize};
    }
    
    box.progress-square {
      min-width: ${sizeConfig.squareSize};
      min-height: ${sizeConfig.squareSize};
    }
    
    box.progress-container {
      /* gap handled by box spacing property */
    }
    
    label.volume-label {
      font-size: ${sizeConfig.fontSize};
      min-width: ${sizeConfig.labelMinWidth};
    }
  `,
    false,
  );
}

/**
 * Get current volume state from wpctl
 */
function getVolumeState(): VolumeState | null {
  try {
    const [ok, stdout] = GLib.spawn_command_line_sync(
      "wpctl get-volume @DEFAULT_AUDIO_SINK@",
    );
    if (!ok || !stdout) return null;

    const decoder = new TextDecoder();
    const output = decoder.decode(stdout).trim();

    // Parse output like "Volume: 0.65 [MUTED]" or "Volume: 0.65"
    const match = output.match(/Volume:\s+([\d.]+)(\s+\[MUTED\])?/);
    if (!match) return null;

    const volumeFraction = Number.parseFloat(match[1]);
    const volume = Math.round(volumeFraction * 100);
    const muted = !!match[2];

    return { volume, muted };
  } catch (e) {
    console.error("Failed to get volume state:", e);
    return null;
  }
}

/**
 * Update UI with new volume state
 */
function updateVolumeUI(state: VolumeState) {
  if (!iconLabel || !volumeLabel || progressSquares.length === 0) return;

  // Update icon
  const speakerState = getSpeakerState(state.volume, state.muted);
  iconLabel.set_label(speakerIcons[speakerState]);

  // Update icon color
  if (speakerState === "muted") {
    iconLabel.add_css_class("muted");
  } else {
    iconLabel.remove_css_class("muted");
  }

  // Update volume label
  const labelText = state.muted ? "Muted" : `${state.volume}%`;
  volumeLabel.set_label(labelText);

  // Update label color
  if (state.muted || state.volume === 0) {
    volumeLabel.add_css_class("muted");
  } else {
    volumeLabel.remove_css_class("muted");
  }

  // Update progress squares (16 total, matching macOS style)
  const totalSquares = 16;
  const filledCount = state.muted
    ? 0
    : Math.round((state.volume / 100) * totalSquares);

  for (let i = 0; i < progressSquares.length; i++) {
    const square = progressSquares[i];
    if (i < filledCount) {
      square.add_css_class("filled");
      square.remove_css_class("empty");
    } else {
      square.remove_css_class("filled");
      square.add_css_class("empty");
    }
  }
}

/**
 * Show the volume indicator
 */
function showIndicator() {
  if (!win) return;

  // Get current volume state
  const state = getVolumeState();
  if (!state) return;

  lastVolumeState = state;

  // Update UI
  updateVolumeUI(state);

  // Show window if hidden
  if (!isVisible) {
    win.set_visible(true);
    isVisible = true;

    // Trigger fade in animation
    const shadowWrapper = win.get_child() as Gtk.Box;
    if (shadowWrapper) {
      shadowWrapper.remove_css_class("hiding");
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        shadowWrapper.add_css_class("visible");
        return false;
      });
    }
  }

  // Reset auto-hide timer
  if (hideTimeoutId !== null) {
    GLib.source_remove(hideTimeoutId);
  }

  hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
    hideIndicator();
    hideTimeoutId = null;
    return false;
  });
}

/**
 * Hide the volume indicator
 */
function hideIndicator() {
  if (!isVisible || !win) return;

  // Cancel any pending hide timeout
  if (hideTimeoutId !== null) {
    GLib.source_remove(hideTimeoutId);
    hideTimeoutId = null;
  }

  // Start fade out animation
  const shadowWrapper = win.get_child() as Gtk.Box;
  if (shadowWrapper) {
    shadowWrapper.remove_css_class("visible");
    shadowWrapper.add_css_class("hiding");
  }

  // Hide window after fade out completes (100ms animation + 10ms buffer)
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 110, () => {
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

/**
 * Create the window and UI
 */
function createWindow(size: "sm" | "md" | "lg" = "sm") {
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

  // Shadow wrapper
  const shadowWrapper = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER,
  });
  shadowWrapper.add_css_class("shadow-wrapper");

  // Main container
  const container = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 0,
    hexpand: false,
  });
  container.add_css_class("indicator-container");

  // Icon container
  const iconContainer = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER,
  });
  iconContainer.add_css_class("icon-container");

  iconLabel = new Gtk.Label({
    label: speakerIcons.medium,
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER,
  });
  iconLabel.add_css_class("speaker-icon");
  iconContainer.append(iconLabel);

  // Progress container with 16 squares
  const sizeConfig = sizes[size];
  const squareGap = Number.parseInt(sizeConfig.squareGap, 10);
  const progressContainer = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: squareGap,
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER,
  });
  progressContainer.add_css_class("progress-container");

  progressSquares = [];
  for (let i = 0; i < 16; i++) {
    const square = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
    });
    square.add_css_class("progress-square");
    square.add_css_class("empty");
    progressSquares.push(square);
    progressContainer.append(square);
  }

  // Volume label
  volumeLabel = new Gtk.Label({
    label: "50%",
    halign: Gtk.Align.END,
    valign: Gtk.Align.CENTER,
  });
  volumeLabel.add_css_class("volume-label");

  // Assemble
  container.append(iconContainer);
  container.append(progressContainer);
  container.append(volumeLabel);
  shadowWrapper.append(container);
  win.set_child(shadowWrapper);

  // Apply size-specific CSS
  updateSizeCSS(size);

  // Initialize with current volume state
  const initialState = getVolumeState();
  if (initialState) {
    lastVolumeState = initialState;
    updateVolumeUI(initialState);
  }
}

// IPC to receive commands via AGS messaging
app.start({
  main() {
    // Pre-create window for instant display
    createWindow("sm");
    return null;
  },
  instanceName: "volume-indicator-daemon",
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
