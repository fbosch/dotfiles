import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { perf } from "./performance-monitor";

interface HyprlandIpcOptions {
  component?: string;
  metric?: string;
  socketName?: string;
  timeoutSeconds?: number;
}

const defaultSocketName = ".socket.sock";
const defaultTimeoutSeconds = 1;

const cachedSocketPaths = new Map<string, string | null>();

function fileExists(path: string): boolean {
  try {
    return Gio.File.new_for_path(path).query_exists(null);
  } catch {
    return false;
  }
}

export function getHyprlandSocketPath(socketName = defaultSocketName): string | null {
  const cachedSocketPath = cachedSocketPaths.get(socketName);
  if (cachedSocketPath !== undefined) return cachedSocketPath;

  const runtimeDir = GLib.getenv("XDG_RUNTIME_DIR");
  const signature = GLib.getenv("HYPRLAND_INSTANCE_SIGNATURE");
  if (!runtimeDir || !signature) {
    cachedSocketPaths.set(socketName, null);
    return null;
  }

  const socketPath = `${runtimeDir}/hypr/${signature}/${socketName}`;
  const availableSocketPath = fileExists(socketPath) ? socketPath : null;
  cachedSocketPaths.set(socketName, availableSocketPath);
  return availableSocketPath;
}

export function hasHyprlandSocket(socketName = defaultSocketName): boolean {
  return getHyprlandSocketPath(socketName) !== null;
}

export function queryHyprland(request: string, options: HyprlandIpcOptions = {}): string | null {
  const socketPath = getHyprlandSocketPath(options.socketName);
  if (!socketPath) return null;

  const mark = perf.start(options.component ?? "hyprland-ipc", options.metric ?? "query");
  let ok = true;
  let error: string | undefined;
  let connection: Gio.SocketConnection | null = null;
  try {
    const socketClient = new Gio.SocketClient();
    socketClient.set_timeout(options.timeoutSeconds ?? defaultTimeoutSeconds);
    const address = Gio.UnixSocketAddress.new(socketPath);
    connection = socketClient.connect(address, null);
    const output = connection.get_output_stream();
    const input = connection.get_input_stream();
    output.write_all(new TextEncoder().encode(request), null);
    output.flush(null);
    connection.get_socket().shutdown(false, true);

    const chunks: Uint8Array[] = [];
    while (true) {
      const bytes = input.read_bytes(8192, null);
      if (bytes.get_size() === 0) break;
      chunks.push(bytes.get_data());
    }

    const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const response = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      response.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(response);
  } catch (e) {
    ok = false;
    error = String(e);
    return null;
  } finally {
    try {
      connection?.close(null);
    } catch {
      // Ignore close failures after a failed socket request.
    }
    mark.end(ok, error);
  }
}

export function queryHyprlandJson<T>(request: string, options: HyprlandIpcOptions = {}): T | null {
  const response = queryHyprland(request, options);
  if (!response) return null;

  try {
    return JSON.parse(response) as T;
  } catch {
    return null;
  }
}

export function dispatchHyprland(dispatcher: string, options: HyprlandIpcOptions = {}): boolean {
  return queryHyprland(`dispatch ${dispatcher}`, {
    ...options,
    metric: options.metric ?? "dispatch",
  }) !== null;
}
