import Gdk from "gi://Gdk?version=4.0";

type PointerDevice = Gdk.Device & {
  get_position(): [unknown, number, number];
};

export type PointerMonitor = {
  monitor: Gdk.Monitor;
  x: number;
  y: number;
};

export function getPointerMonitor(): PointerMonitor | null {
  const display = Gdk.Display.get_default();
  const pointer = display?.get_default_seat()?.get_pointer() as PointerDevice | null;
  if (!display || !pointer) return null;

  // GTK4 removed Display.get_monitor_at_point(); locate the pointer in its monitor model.
  const [, x, y] = pointer.get_position();
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
