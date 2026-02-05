import { Astal } from "ags/gtk4";
import app from "ags/gtk4/app";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import { execAsync } from "ags/process";
import { perf } from "./performance-monitor";

// Size configuration matching design-system component
const size = {
  containerPadding: "6px 12px",
  iconSize: 20,
  squareSize: 8,
  squareGap: 2,
  fontSize: 12,
  topMargin: 20,
};

type SpeakerState =
  | "muted"
  | "verylow"
  | "low"
  | "medium"
  | "high"
  | "veryhigh";

const speakerIcons: Record<SpeakerState, string> = {
  muted: "\uE74F",
  verylow: "\uE992",
  low: "\uE993",
  medium: "\uE994",
  high: "\uE995",
  veryhigh: "\uE995",
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

const volumeCache = { volume: 0, muted: false, timestamp: 0 };
const CACHE_DURATION = 30;

async function getVolumeInfo(): Promise<{ volume: number; muted: boolean }> {
  const now = Date.now();

  if (now - volumeCache.timestamp < CACHE_DURATION) {
    return { volume: volumeCache.volume, muted: volumeCache.muted };
  }

  try {
    const volumeText = await execAsync("wpctl get-volume @DEFAULT_AUDIO_SINK@");
    const volumeMatch = volumeText.match(/Volume:\s+([\d.]+)/);
    const volume = volumeMatch
      ? Math.round(parseFloat(volumeMatch[1]) * 100)
      : 0;
    const muted = volumeText.includes("[MUTED]");

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

let win: Astal.Window | null = null;
let shadowWrapper: Gtk.Box | null = null;
let hideTimeout: number | null = null;
let progressSquares: Gtk.Box[] = [];
let iconLabel: Gtk.Label | null = null;
let volumeLabel: Gtk.Label | null = null;
let isVisible = false;

let lastVolume = -1;
let lastMuted = false;
let lastSpeakerState: SpeakerState | null = null;
let lastSegmentCount = -1;
let volumeUpdateInFlight = false;

async function update() {
  const mark = perf.start("volume-indicator", "update");
  let ok = true;
  let error: string | undefined;
  try {
    if (volumeUpdateInFlight) {
      mark.end(ok, error);
      return;
    }
    volumeUpdateInFlight = true;
    if (!iconLabel || !volumeLabel || progressSquares.length === 0) {
      volumeUpdateInFlight = false;
      mark.end(ok, error);
      return;
    }
    const { volume, muted } = await getVolumeInfo();

    if (volume === lastVolume && muted === lastMuted) return;

    const speakerState = getSpeakerState(volume, muted);

    if (speakerState !== lastSpeakerState) {
      iconLabel.set_label(speakerIcons[speakerState]);

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

    if (volume !== lastVolume || muted !== lastMuted) {
      volumeLabel.set_label(muted ? "Muted" : `${volume}%`);

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

    if (volume !== lastVolume || muted !== lastMuted) {
      const filledCount = muted ? 0 : Math.round((volume / 100) * 20);
      const lastFilledCount = lastMuted ? 0 : Math.round((lastVolume / 100) * 20);

      if (filledCount !== lastFilledCount) {
        const minChange = Math.min(filledCount, lastFilledCount);
        const maxChange = Math.max(filledCount, lastFilledCount);

        for (let i = minChange; i < maxChange; i++) {
          if (!progressSquares[i]) continue; // Skip if element not initialized yet
          
          if (i < filledCount) {
            progressSquares[i].add_css_class("filled");
            progressSquares[i].remove_css_class("empty");
          } else {
            progressSquares[i].remove_css_class("filled");
            progressSquares[i].add_css_class("empty");
          }
        }

        if (filledCount !== lastSegmentCount && lastSegmentCount !== -1) {
          playVolumeSound(muted);
        }
        lastSegmentCount = filledCount;
      }
    }

    lastVolume = volume;
    lastMuted = muted;
  } catch (e) {
    ok = false;
    error = String(e);
    throw e;
  } finally {
    volumeUpdateInFlight = false;
    mark.end(ok, error);
  }
}

function hideIndicator() {
  if (!isVisible || !win || !shadowWrapper) {
    return;
  }

  if (hideTimeout !== null) {
    GLib.source_remove(hideTimeout);
    hideTimeout = null;
  }

  shadowWrapper.remove_css_class("visible");
  shadowWrapper.add_css_class("hiding");

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

function playVolumeSound(muted: boolean) {
  if (!muted) {
    try {
      GLib.spawn_command_line_async(
        "sh -c 'sox -n -t wav - synth 0.03 sine 800 vol 0.2 2>/dev/null | pw-play - --volume=0.5 2>/dev/null &'",
      );
    } catch {
      // Silently fail
    }
  }
}

function showIndicator() {
  const mark = perf.start("volume-indicator", "showIndicator");
  let ok = true;
  let error: string | undefined;
  try {
    if (!win) {
      createWindow();
    }
    
    if (!shadowWrapper) return;

    void update();

    if (!isVisible) {
      win.set_visible(true);
      isVisible = true;

      shadowWrapper.remove_css_class("hiding");
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        shadowWrapper?.add_css_class("visible");
        return false;
      });
    }

    if (hideTimeout !== null) {
      GLib.source_remove(hideTimeout);
    }

    hideTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
      hideIndicator();
      hideTimeout = null;
      return false;
    });
  } catch (e) {
    ok = false;
    error = String(e);
    throw e;
  } finally {
    mark.end(ok, error);
  }
}

function createWindow() {
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
      application={app}
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

          <box
            orientation={Gtk.Orientation.HORIZONTAL}
            spacing={size.squareGap}
            valign={Gtk.Align.CENTER}
            class="progress-container"
          >
            {squares}
          </box>

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

  void update();
}

function applyCSS() {
  app.apply_css(
    `
  window.volume-indicator {
    background-color: transparent;
    border: none;
  }
  
  window.volume-indicator box.shadow-wrapper {
    padding: 40px;
    opacity: 0;
    transition: opacity 100ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  
  window.volume-indicator box.shadow-wrapper.visible {
    opacity: 1;
  }
  
  window.volume-indicator box.shadow-wrapper.hiding {
    opacity: 0;
    transition: opacity 50ms cubic-bezier(0.4, 0, 1, 1);
  }
  
  window.volume-indicator box.indicator-container {
    background-color: rgba(55, 55, 55, 0.80);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 9999px;
    padding: ${size.containerPadding};
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  }
  
  window.volume-indicator box.icon-container {
    min-width: ${size.iconSize}px;
    min-height: ${size.iconSize}px;
    margin-right: 12px;
  }
  
  window.volume-indicator label.speaker-icon {
    font-family: "Segoe Fluent Icons";
    font-size: ${size.iconSize}px;
    color: white;
  }
  
  window.volume-indicator label.speaker-icon.muted {
    color: rgba(255, 255, 255, 0.5);
  }
  
  window.volume-indicator box.progress-container {
    margin-right: 12px;
    min-height: ${size.squareSize}px;
    max-height: ${size.squareSize}px;
  }
  
  window.volume-indicator box.progress-square {
    min-width: ${size.squareSize}px;
    min-height: ${size.squareSize}px;
    max-width: ${size.squareSize}px;
    max-height: ${size.squareSize}px;
    border-radius: 2px;
    transition: background-color 150ms ease;
  }
  
  window.volume-indicator box.progress-square.filled {
    background-color: white;
  }
  
  window.volume-indicator box.progress-square.empty {
    background-color: rgba(255, 255, 255, 0.2);
  }

  window.volume-indicator label.volume-label {
    font-family: system-ui, sans-serif;
    font-weight: 700;
    font-size: ${size.fontSize}px;
    color: white;
    min-width: 42px;
  }
  
  window.volume-indicator label.volume-label.muted {
    color: rgba(255, 255, 255, 0.5);
  }
`,
    false,
  );
}

// Functions for bundled mode (using global namespace pattern)
function initVolumeIndicator() {
  applyCSS();
  // Window created lazily on first show (see showIndicator line 204)
}

function handleVolumeIndicatorRequest(argv: string[], res: (response: string) => void) {
  const mark = perf.start("volume-indicator", "handleRequest");
  let ok = true;
  let error: string | undefined;
  try {
    const request = argv.join(" ");

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
    } else if (data.action === "get-visibility") {
      res(isVisible ? "visible" : "hidden");
    } else {
      res("unknown action");
    }
  } catch (e) {
    ok = false;
    error = String(e);
    console.error("Error handling volume-indicator request:", e);
    res(`error: ${e}`);
  } finally {
    mark.end(ok, error);
  }
}

// Make component available globally
globalThis.VolumeIndicator = {
  init: initVolumeIndicator,
  handleRequest: handleVolumeIndicatorRequest,
  instanceName: "volume-indicator"
};
