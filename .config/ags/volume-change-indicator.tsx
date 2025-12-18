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
  muted: "\uE74F", // Muted/Volume 0
  verylow: "\uE992", // Very low volume
  low: "\uE993", // Low volume
  medium: "\uE994", // Medium volume
  high: "\uE995", // High volume
  veryhigh: "\uE995", // Very high volume
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
// Cache for volume info to reduce wpctl calls during rapid updates
const volumeCache = { volume: 0, muted: false, timestamp: 0 };
const CACHE_DURATION = 30; // ms - cache to handle rapid volume changes

function getVolumeInfo(): { volume: number; muted: boolean } {
  const now = Date.now();

  // Return cached value if very recent (for rapid key presses)
  if (now - volumeCache.timestamp < CACHE_DURATION) {
    return { volume: volumeCache.volume, muted: volumeCache.muted };
  }

  try {
    // Get volume for default audio sink (@DEFAULT_AUDIO_SINK@)
    const [ok, stdout, , exit_status] = GLib.spawn_command_line_sync(
      "wpctl get-volume @DEFAULT_AUDIO_SINK@",
    );

    if (!ok || exit_status !== 0 || !stdout) {
      return volumeCache.timestamp > 0
        ? volumeCache
        : { volume: 0, muted: false };
    }

    const volumeText = new TextDecoder().decode(stdout);

    // Parse output like "Volume: 0.50" or "Volume: 0.50 [MUTED]"
    const volumeMatch = volumeText.match(/Volume:\s+([\d.]+)/);
    const volume = volumeMatch
      ? Math.round(parseFloat(volumeMatch[1]) * 100)
      : 0;
    const muted = volumeText.includes("[MUTED]");

    // Update cache
    volumeCache.volume = volume;
    volumeCache.muted = muted;
    volumeCache.timestamp = now;

    return { volume, muted };
  } catch (e) {
    console.error("Failed to get volume info:", e);
    return volumeCache.timestamp > 0
      ? volumeCache
      : { volume: 0, muted: false };
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
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
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

// Cache last update state to avoid redundant DOM operations
let lastVolume = -1;
let lastMuted = false;
let lastSpeakerState: SpeakerState | null = null;
let lastSegmentCount = -1;

function update() {
  if (!iconLabel || !volumeLabel) return;

  const { volume, muted } = getVolumeInfo();

  // Early return if nothing changed
  if (volume === lastVolume && muted === lastMuted) return;

  const speakerState = getSpeakerState(volume, muted);

  // Update icon only if state changed
  if (speakerState !== lastSpeakerState) {
    iconLabel.set_label(speakerIcons[speakerState]);

    // Toggle muted class only if changed
    const wasMuted = lastSpeakerState === "muted";
    const isMuted = speakerState === "muted";
    if (wasMuted !== isMuted) {
      if (isMuted) {
        iconLabel.add_css_class("muted");
      } else {
        iconLabel.remove_css_class("muted");
      }
    }
    lastSpeakerState = speakerState;
  }

  // Update volume label only if changed
  if (volume !== lastVolume || muted !== lastMuted) {
    volumeLabel.set_label(muted ? "Muted" : `${volume}%`);

    // Toggle muted class only if changed
    const shouldBeMuted = muted || volume === 0;
    const wasMutedLabel = lastMuted || lastVolume === 0;
    if (shouldBeMuted !== wasMutedLabel) {
      if (shouldBeMuted) {
        volumeLabel.add_css_class("muted");
      } else {
        volumeLabel.remove_css_class("muted");
      }
    }
  }

  // Update progress squares only if volume changed
  if (volume !== lastVolume || muted !== lastMuted) {
    const filledCount = muted ? 0 : Math.round((volume / 100) * 20);
    const lastFilledCount = lastMuted ? 0 : Math.round((lastVolume / 100) * 20);

    // Only update squares that changed state
    if (filledCount !== lastFilledCount) {
      const minChange = Math.min(filledCount, lastFilledCount);
      const maxChange = Math.max(filledCount, lastFilledCount);

      for (let i = minChange; i < maxChange; i++) {
        if (i < filledCount) {
          progressSquares[i].add_css_class("filled");
          progressSquares[i].remove_css_class("empty");
        } else {
          progressSquares[i].remove_css_class("filled");
          progressSquares[i].add_css_class("empty");
        }
      }

      // Play sound when segment count changes (but not on first initialization)
      if (filledCount !== lastSegmentCount && lastSegmentCount !== -1) {
        playVolumeSound();
      }
      lastSegmentCount = filledCount;
    }
  }

  // Update cache
  lastVolume = volume;
  lastMuted = muted;
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

// Play volume feedback sound immediately when segment changes
function playVolumeSound() {
  const { muted } = getVolumeInfo();

  if (!muted) {
    // Play a short beep sound asynchronously (non-blocking)
    // Using sox to generate a 30ms sine wave at 800Hz, played through pw-play
    try {
      GLib.spawn_command_line_async(
        "sh -c 'sox -n -t wav - synth 0.03 sine 800 vol 0.2 2>/dev/null | pw-play - --volume=0.5 2>/dev/null &'",
      );
    } catch {
      // Silently fail if sound playback fails
    }
  }
}

function showIndicator() {
  if (!win || !shadowWrapper) return;

  // Update volume info before showing (this will play sound if segment changed)
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
  // Create progress squares using JSX
  const squares: JSX.Element[] = [];
  for (let i = 0; i < 20; i++) {
    squares.push(
      <box
        class="progress-square empty"
        $={(self: Gtk.Box) => {
          progressSquares[i] = self;
        }}
      />,
    );
  }

  win = (
    <window
      name="volume-indicator"
      namespace="ags-volume-indicator"
      visible={false}
      anchor={Astal.WindowAnchor.NONE}
      layer={Astal.Layer.OVERLAY}
      exclusivity={Astal.Exclusivity.NORMAL}
      keymode={Astal.Keymode.NONE}
      class="volume-indicator"
    >
      <box
        orientation={Gtk.Orientation.HORIZONTAL}
        halign={Gtk.Align.CENTER}
        valign={Gtk.Align.CENTER}
        class="shadow-wrapper"
        $={(self: Gtk.Box) => {
          shadowWrapper = self;
        }}
      >
        <box
          orientation={Gtk.Orientation.HORIZONTAL}
          spacing={0}
          class="indicator-container"
        >
          {/* Icon container */}
          <box
            orientation={Gtk.Orientation.HORIZONTAL}
            halign={Gtk.Align.CENTER}
            valign={Gtk.Align.CENTER}
            class="icon-container"
          >
            <label
              label=""
              class="speaker-icon"
              $={(self: Gtk.Label) => {
                iconLabel = self;
              }}
            />
          </box>

          {/* Progress squares container */}
          <box
            orientation={Gtk.Orientation.HORIZONTAL}
            spacing={size.squareGap}
            valign={Gtk.Align.CENTER}
            class="progress-container"
          >
            {squares}
          </box>

          {/* Volume label */}
          <label
            label="0%"
            class="volume-label"
            $={(self: Gtk.Label) => {
              volumeLabel = self;
            }}
          />
        </box>
      </box>
    </window>
  ) as Astal.Window;

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

      // Handle empty requests gracefully
      if (!request || request.trim() === "") {
        res("ok");
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
