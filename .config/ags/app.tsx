import app from "ags/gtk4/app";
import { Astal } from "ags/gtk4";
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

let overlayVisible = false;
let hideTimeout = null;
let tabData = null;

function getWindowData() {
  // Get all windows
  let [ok, clientsJson] = GLib.spawn_command_line_sync("hyprctl clients -j");
  let [ok2, activeJson] = GLib.spawn_command_line_sync("hyprctl activewindow -j");
  if (!ok || !ok2) return null;

  const decoder = new TextDecoder();
  let clients = JSON.parse(decoder.decode(clientsJson));
  let active = JSON.parse(decoder.decode(activeJson));

  // Sort and build window list
  let windows = clients
    .filter(w => w.workspace && w.workspace.id !== -1)
    .sort((a, b) => {
      if (a.class !== b.class) return a.class.localeCompare(b.class);
      if ((a.title || "") !== (b.title || "")) return (a.title || "").localeCompare(b.title || "");
      return a.address.localeCompare(b.address);
    })
    .map(w => ({
      title: w.title || "Untitled",
      address: w.address,
      workspace: w.workspace.name || w.workspace.id.toString(),
    }));

  // Find current index
  let current_index = windows.findIndex(w => w.address === active.address);

  return { windows, current_index };
}

function showOverlay() {
  tabData = getWindowData();
  overlayVisible = true;
  if (hideTimeout) GLib.source_remove(hideTimeout);
  hideTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
    overlayVisible = false;
    return GLib.SOURCE_REMOVE;
  });
}

// Watch for changes to /tmp/hypr-tab-cycle.json (triggered by Alt-Tab)
const file = Gio.File.new_for_path("/tmp/hypr-tab-cycle.json");
const monitor = file.monitor(Gio.FileMonitorFlags.NONE, null);
monitor.connect('changed', (monitor, file, other_file, event_type) => {
  if (event_type === Gio.FileMonitorEvent.CHANGED) {
    showOverlay();
  }
});

function TabOverlay() {
  if (!overlayVisible || !tabData) return null;
  return (
    <window
      visible
      anchor={Astal.WindowAnchor.CENTER}
      layer="overlay"
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
      focusable={false}
      class="tab-overlay"
    >
      <box orientation="vertical">
        {tabData.windows.map((win, i) => (
          <label
            label={win.title}
            class={i === tabData.current_index ? "selected" : ""}
          />
        ))}
      </box>
    </window>
  );
}

app.start({
  main() {
    return <TabOverlay />;
  },
});
