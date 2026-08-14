import Gdk from "gi://Gdk?version=4.0";
import { queryHyprlandJson } from "./hyprland-ipc";

export type PointerMonitor = {
  monitor: Gdk.Monitor;
  x: number;
  y: number;
};

export function getPointerMonitor(): PointerMonitor | null {
  const display = Gdk.Display.get_default();
  const position = queryHyprlandJson<{ x?: unknown; y?: unknown }>("j/cursorpos", {
    component: "pointer-monitor",
    metric: "cursorPosition",
  });
  if (
    !display ||
    typeof position?.x !== "number" ||
    typeof position.y !== "number"
  )
    return null;

  const { x, y } = position;
  const monitors = display.get_monitors();
  for (let index = 0; index < monitors.get_n_items(); index += 1) {
    const monitor = monitors.get_item(index) as Gdk.Monitor | null;
    if (!monitor) continue;

    const geometry = monitor.get_geometry();
    const containsPointer =
      x >= geometry.x &&
      x < geometry.x + geometry.width &&
      y >= geometry.y &&
      y < geometry.y + geometry.height;
    if (containsPointer) return { monitor, x, y };
  }

  return null;
}
