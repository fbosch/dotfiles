import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  type AgentToolResult,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  defineTool,
  type ExtensionAPI,
  type ExtensionCommandContext,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type Mode = "auto" | "browser" | "window" | "region" | "monitor" | "full";
type Format = "png" | "jpeg";

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type HyprlandCommandRunner = (
  command: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
  environment?: Readonly<Record<string, string>>,
) => Promise<CommandResult>;
type Geometry = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Monitor = Geometry & {
  name: string;
  focused: boolean;
  id: number | null;
};

type WorkspaceInfo = {
  id: number | null;
  name: string;
  monitor: string;
};

type WindowInfo = {
  className: string;
  initialClass: string;
  title: string;
  stableId: string;
  address: string;
  monitor: number | null;
  workspace: WorkspaceInfo | null;
  position: [number, number] | null;
  size: [number, number] | null;
  visible: boolean;
  mapped: boolean;
};

type Layer = Geometry & {
  namespace: string;
  monitor: string;
  level: string;
};

type CaptureResult = {
  path: string;
  method: string;
  target?: string;
  geometry?: Geometry;
  window?: WindowInfo;
  fallback?: string[];
};

type DiagnosticSource<T> = { status: "ok"; value: T } | { status: "unavailable"; error: string };
type DiagnosticFailure = {
  source: string;
  error: string;
};
type ProfileStatus = {
  generation: number;
  resolved: string;
  selection: string;
  sources: Record<string, Record<string, number>>;
};
type WindowCaptureStatus = {
  daemon: "running" | "paused" | "missing";
  worker: "running" | "paused" | "missing";
};
type HyprlandDiagnosticDetails = {
  timestamp: string;
  compositor: {
    activeWindow: WindowInfo | null;
    activeWorkspace: WorkspaceInfo | null;
    clients: WindowInfo[];
    monitors: Monitor[];
    layers: Layer[];
    configErrors: string[] | null;
  };
  runtime: {
    profile: ProfileStatus | null;
    presentation: string | null;
    windowCapture: WindowCaptureStatus | null;
    waybar: "running" | "stopped" | null;
  };
  unavailable: DiagnosticFailure[];
};

const browserClasses = new Set([
  "app.zen_browser.zen",
  "brave-browser",
  "chromium",
  "firefox",
  "google-chrome",
  "microsoft-edge",
  "org.mozilla.firefox",
  "vivaldi",
  "zen",
]);

const chromiumClasses = new Set([
  "brave-browser",
  "chromium",
  "google-chrome",
  "microsoft-edge",
  "vivaldi",
]);
const COMMAND_TIMEOUT_MS = 15_000;
const CDP_REQUEST_TIMEOUT_MS = 5_000;
const CDP_SOCKET_TIMEOUT_MS = 5_000;
const CDP_CLEANUP_TIMEOUT_MS = 1_000;

function createCommandRunner(pi: ExtensionAPI, timeoutMs?: number): HyprlandCommandRunner {
  return async (command, args, cwd, signal, environment) => {
    try {
      const executable = environment === undefined ? command : "env";
      const executableArgs =
        environment === undefined
          ? args
          : [
              ...Object.entries(environment).map(([name, value]) => `${name}=${value}`),
              command,
              ...args,
            ];
      const result = await pi.exec(executable, executableArgs, {
        cwd,
        ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
        ...(signal === undefined ? {} : { signal }),
      });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.code };
    } catch (error) {
      if (signal?.aborted) throw error;
      return {
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 127,
      };
    }
  };
}

function signalWithTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && Array.isArray(value) === false
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : [];
}

async function hyprctlJson(
  request: string,
  cwd: string,
  runCommand: HyprlandCommandRunner,
  signal: AbortSignal | undefined,
): Promise<unknown | null> {
  const result = await runCommand("hyprctl", [request, "-j"], cwd, signal);
  if (result.exitCode !== 0) {
    return null;
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function parseWorkspace(value: unknown): WorkspaceInfo | null {
  const input = objectValue(value);
  if (input === null || Object.keys(input).length === 0) {
    return null;
  }

  const id = numberValue(input.id);
  const name = stringValue(input.name);
  const monitor = stringValue(input.monitor);
  if (id === null && name === "") {
    return null;
  }

  return { id, name, monitor };
}

function parseWindow(value: unknown): WindowInfo | null {
  const input = objectValue(value);
  if (input === null || Object.keys(input).length === 0) {
    return null;
  }

  const position = numberArray(input.at);
  const size = numberArray(input.size);
  return {
    className: stringValue(input.class),
    initialClass: stringValue(input.initialClass),
    title: stringValue(input.title),
    stableId: stringValue(input.stableId),
    address: stringValue(input.address),
    monitor: numberValue(input.monitor),
    workspace: parseWorkspace(input.workspace),
    position:
      position.length >= 2 && position[0] !== undefined && position[1] !== undefined
        ? [position[0], position[1]]
        : null,
    size:
      size.length >= 2 && size[0] !== undefined && size[1] !== undefined
        ? [size[0], size[1]]
        : null,
    visible: booleanValue(input.visible, true),
    mapped: booleanValue(input.mapped, true),
  };
}

function parseWindows(value: unknown): WindowInfo[] {
  if (Array.isArray(value) === false) {
    return [];
  }

  return value.map(parseWindow).filter((window): window is WindowInfo => window !== null);
}

function parseMonitors(value: unknown): Monitor[] {
  if (Array.isArray(value) === false) {
    return [];
  }

  const monitors: Monitor[] = [];
  for (const item of value) {
    const input = objectValue(item);
    if (input === null) {
      continue;
    }

    const x = numberValue(input.x);
    const y = numberValue(input.y);
    const width = numberValue(input.width);
    const height = numberValue(input.height);
    const name = stringValue(input.name);
    if (x === null || y === null || width === null || height === null || name === "") {
      continue;
    }

    monitors.push({
      x,
      y,
      width,
      height,
      name,
      focused: booleanValue(input.focused, false),
      id: numberValue(input.id),
    });
  }

  return monitors;
}

function collectLayers(value: unknown, monitor = "", level = "", layers: Layer[] = []): Layer[] {
  const input = objectValue(value);
  if (input === null) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectLayers(item, monitor, level, layers);
      }
    }
    return layers;
  }

  const x = numberValue(input.x);
  const y = numberValue(input.y);
  const width = numberValue(input.w) ?? numberValue(input.width);
  const height = numberValue(input.h) ?? numberValue(input.height);
  const namespace = stringValue(input.namespace);
  if (x !== null && y !== null && width !== null && height !== null && namespace !== "") {
    layers.push({ x, y, width, height, namespace, monitor, level });
    return layers;
  }

  for (const [key, item] of Object.entries(input)) {
    if (key === "levels") {
      collectLayers(item, monitor, level, layers);
    } else if (monitor === "" && objectValue(item)?.levels !== undefined) {
      collectLayers(item, key, level, layers);
    } else if (/^\d+$/.test(key)) {
      collectLayers(item, monitor, key, layers);
    } else {
      collectLayers(item, monitor, level, layers);
    }
  }

  return layers;
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, "");
}

function hintTokens(hint: string): string[] {
  return hint
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .map(normalizeToken)
    .filter((token) => token.length >= 3);
}

function scoreWindow(window: WindowInfo, tokens: string[]): number {
  const classes = [normalizeToken(window.className), normalizeToken(window.initialClass)];
  const title = window.title.toLowerCase();
  let score = 0;

  for (const token of tokens) {
    if (classes.includes(token)) {
      score += 6;
    } else if (classes.some((item) => item.includes(token))) {
      score += 4;
    }

    if (title === token) {
      score += 3;
    } else if (title.includes(token)) {
      score += 2;
    }
  }

  return score;
}

function windowForHint(
  activeWindow: WindowInfo | null,
  clients: WindowInfo[],
  hint: string,
): WindowInfo | null {
  const tokens = hintTokens(hint);
  if (tokens.length === 0) {
    return activeWindow;
  }

  let selected: WindowInfo | null = null;
  let highestScore = 0;
  for (const client of clients) {
    const score = scoreWindow(client, tokens);
    if (score > highestScore) {
      selected = client;
      highestScore = score;
    }
  }

  return selected ?? activeWindow;
}

function focusedMonitor(monitors: Monitor[], activeWindow: WindowInfo | null): Monitor | null {
  const focused = monitors.find((monitor) => monitor.focused);
  if (focused !== undefined) {
    return focused;
  }

  if (activeWindow?.monitor !== null && activeWindow?.monitor !== undefined) {
    const windowMonitor = monitors.find((monitor) => monitor.id === activeWindow.monitor);
    if (windowMonitor !== undefined) {
      return windowMonitor;
    }
  }

  return monitors[0] ?? null;
}

function windowTarget(window: WindowInfo): string {
  if (window.stableId !== "") {
    return window.stableId;
  }

  return window.address.replace(/^0x/, "");
}

function isBrowserWindow(window: WindowInfo | null): boolean {
  if (window === null) {
    return false;
  }

  const classes = [window.className, window.initialClass].map((item) => item.toLowerCase());
  return classes.some(
    (item) =>
      browserClasses.has(item) ||
      item.includes("browser") ||
      item.includes("chromium") ||
      item.includes("firefox"),
  );
}

function isChromiumWindow(window: WindowInfo | null): boolean {
  if (window === null) {
    return false;
  }

  const classes = [window.className, window.initialClass].map((item) => item.toLowerCase());
  return classes.some(
    (item) => chromiumClasses.has(item) || item.includes("chromium") || item.includes("chrome"),
  );
}

function looksLikeWidgetHint(hint: string): boolean {
  return /\b(widget|layer|overlay|bar|popup|menu|calendar|tray|panel|launcher|notification|dock)\b/i.test(
    hint,
  );
}

function looksLikePopupHint(hint: string): boolean {
  return /\b(popup|menu|calendar|widget|launcher|overlay)\b/i.test(hint);
}

function isThinBarGeometry(geometry: Geometry): boolean {
  return geometry.height <= 120 || geometry.width <= 120;
}

function scoreLayer(layer: Layer, tokens: string[]): number {
  const namespace = layer.namespace.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (namespace === token) {
      score += 4;
    } else if (namespace.includes(token) || token.includes(namespace)) {
      score += 2;
    }
  }

  if (namespace.includes("bar") && tokens.includes("bar")) score += 3;
  if (namespace.includes("tray") && tokens.includes("tray")) score += 3;
  if (namespace.includes("calendar") && tokens.includes("calendar")) score += 3;
  if (namespace.includes("notification") && tokens.includes("notification")) score += 3;

  return score;
}

function inferLayerGeometry(
  hint: string,
  layers: Layer[],
): { geometry: Geometry; target: string } | null {
  const tokens = hintTokens(hint);
  if (tokens.length === 0) {
    return null;
  }

  let best: { layer: Layer; score: number } | null = null;
  for (const layer of layers) {
    const score = scoreLayer(layer, tokens);
    if (score > 0 && (best === null || score > best.score)) {
      best = { layer, score };
    }
  }

  if (best === null) {
    return null;
  }

  return {
    geometry: {
      x: best.layer.x,
      y: best.layer.y,
      width: best.layer.width,
      height: best.layer.height,
    },
    target: `${best.layer.namespace} on ${best.layer.monitor || "unknown monitor"}`,
  };
}

function insetGeometry(monitor: Monitor, horizontalRatio: number, verticalRatio: number): Geometry {
  const width = Math.round(monitor.width * horizontalRatio);
  const height = Math.round(monitor.height * verticalRatio);
  return {
    x: monitor.x + Math.round((monitor.width - width) / 2),
    y: monitor.y + Math.round((monitor.height - height) / 2),
    width,
    height,
  };
}

function inferRegionGeometry(
  hint: string,
  monitor: Monitor | null,
): { geometry: Geometry; target: string } | null {
  if (monitor === null) {
    return null;
  }

  const lower = hint.toLowerCase();
  if (/\bbottom\b/.test(lower)) {
    const height = Math.round(monitor.height * 0.35);
    return {
      geometry: {
        x: monitor.x,
        y: monitor.y + monitor.height - height,
        width: monitor.width,
        height,
      },
      target: `bottom of ${monitor.name}`,
    };
  }
  if (/\btop\b/.test(lower)) {
    const height = Math.round(monitor.height * 0.35);
    return {
      geometry: { x: monitor.x, y: monitor.y, width: monitor.width, height },
      target: `top of ${monitor.name}`,
    };
  }
  if (/\bleft\b/.test(lower)) {
    const width = Math.round(monitor.width * 0.35);
    return {
      geometry: { x: monitor.x, y: monitor.y, width, height: monitor.height },
      target: `left of ${monitor.name}`,
    };
  }
  if (/\bright\b/.test(lower)) {
    const width = Math.round(monitor.width * 0.35);
    return {
      geometry: {
        x: monitor.x + monitor.width - width,
        y: monitor.y,
        width,
        height: monitor.height,
      },
      target: `right of ${monitor.name}`,
    };
  }

  if (/\b(center|popup|menu|calendar|widget|launcher|overlay)\b/.test(lower)) {
    return { geometry: insetGeometry(monitor, 0.7, 0.7), target: `center of ${monitor.name}` };
  }

  return null;
}

function inferContextRegion(
  hint: string,
  layers: Layer[],
  monitor: Monitor | null,
): { geometry: Geometry; target: string } | null {
  const exact = inferLayerGeometry(hint, layers);
  if (
    exact !== null &&
    (looksLikePopupHint(hint) === false || isThinBarGeometry(exact.geometry) === false)
  ) {
    return exact;
  }

  return inferRegionGeometry(hint, monitor) ?? exact;
}

async function outputDirectory(): Promise<string> {
  const base = existsSync("/dev/shm") ? "/dev/shm" : tmpdir();
  const directory = join(base, "pi-window-screenshots");
  await mkdir(directory, { recursive: true });
  return directory;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function outputPath(format: Format): Promise<string> {
  return join(
    await outputDirectory(),
    `screenshot-${timestamp()}.${format === "jpeg" ? "jpg" : "png"}`,
  );
}

async function grim(
  args: string[],
  cwd: string,
  runCommand: HyprlandCommandRunner,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const result = await runCommand("grim", args, cwd, signal);
  if (result.exitCode === 0) {
    return null;
  }

  return (
    result.stderr.trim() ||
    result.stdout.trim() ||
    `grim failed with exit ${result.exitCode ?? "unknown"}`
  );
}

function grimFormatArgs(format: Format): string[] {
  return format === "jpeg" ? ["-t", "jpeg", "-q", "90"] : [];
}

async function captureWindow(
  window: WindowInfo | null,
  format: Format,
  cwd: string,
  runCommand: HyprlandCommandRunner,
  signal: AbortSignal | undefined,
): Promise<CaptureResult | string> {
  if (window === null || window.mapped === false) {
    return "No mapped window matched the hint.";
  }

  const position = window.position;
  const size = window.size;
  if (position === null || size === null || size[0] <= 0 || size[1] <= 0) {
    return "Window has no usable geometry.";
  }

  const target = windowTarget(window);
  const geometry = { x: position[0], y: position[1], width: size[0], height: size[1] };
  const region = `${geometry.x},${geometry.y} ${geometry.width}x${geometry.height}`;
  const path = await outputPath(format);
  const error = await grim(
    [...grimFormatArgs(format), "-g", region, path],
    cwd,
    runCommand,
    signal,
  );
  return (
    error ?? {
      path,
      method: "window",
      ...(target === "" ? {} : { target }),
      geometry,
      window,
    }
  );
}

async function captureRegion(
  geometry: Geometry,
  target: string,
  format: Format,
  cwd: string,
  runCommand: HyprlandCommandRunner,
  signal: AbortSignal | undefined,
): Promise<CaptureResult | string> {
  const path = await outputPath(format);
  const region = `${geometry.x},${geometry.y} ${geometry.width}x${geometry.height}`;
  const error = await grim(
    [...grimFormatArgs(format), "-g", region, path],
    cwd,
    runCommand,
    signal,
  );
  return error ?? { path, method: "region", target, geometry };
}

async function captureMonitor(
  monitor: Monitor | null,
  format: Format,
  cwd: string,
  runCommand: HyprlandCommandRunner,
  signal: AbortSignal | undefined,
): Promise<CaptureResult | string> {
  const path = await outputPath(format);
  if (monitor === null) {
    const error = await grim([...grimFormatArgs(format), path], cwd, runCommand, signal);
    return error ?? { path, method: "full" };
  }

  const error = await grim(
    [...grimFormatArgs(format), "-o", monitor.name, path],
    cwd,
    runCommand,
    signal,
  );
  return error ?? { path, method: "monitor", target: monitor.name, geometry: monitor };
}

async function captureFull(
  format: Format,
  cwd: string,
  runCommand: HyprlandCommandRunner,
  signal: AbortSignal | undefined,
): Promise<CaptureResult | string> {
  const path = await outputPath(format);
  const error = await grim([...grimFormatArgs(format), path], cwd, runCommand, signal);
  return error ?? { path, method: "full" };
}

function cdpCandidates(): string[] {
  const candidates = [
    process.env.PLAYWRIGHT_CDP_URL,
    process.env.CHROME_REMOTE_DEBUGGING_URL,
    "http://127.0.0.1:9222",
    "http://localhost:9222",
  ];
  return candidates.filter((item): item is string => typeof item === "string" && item.length > 0);
}

type CdpTab = {
  type?: unknown;
  url?: unknown;
  title?: unknown;
  webSocketDebuggerUrl?: unknown;
};

async function fetchTabs(
  endpoint: string,
  signal: AbortSignal | undefined,
): Promise<CdpTab[] | string> {
  try {
    const response = await fetch(new URL("/json/list", endpoint), {
      signal: signalWithTimeout(signal, CDP_REQUEST_TIMEOUT_MS),
    });
    if (response.ok === false) {
      return `${endpoint}/json/list returned ${response.status}`;
    }

    const value = await response.json();
    return Array.isArray(value) ? value : "CDP /json/list did not return an array";
  } catch (error) {
    return error instanceof Error ? error.message : "Failed to fetch CDP tabs";
  }
}

function pickTab(tabs: CdpTab[], hint: string): CdpTab | null {
  const pageTabs = tabs.filter(
    (tab) => tab.type === "page" && typeof tab.webSocketDebuggerUrl === "string",
  );
  if (pageTabs.length === 0) {
    return null;
  }

  const tokens = hintTokens(hint);
  if (tokens.length > 0) {
    const scored = pageTabs
      .map((tab) => {
        const haystack = `${stringValue(tab.title)} ${stringValue(tab.url)}`.toLowerCase();
        return { tab, score: tokens.filter((token) => haystack.includes(token)).length };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);
    if (scored[0] !== undefined) {
      return scored[0].tab;
    }
  }

  return pageTabs[0] ?? null;
}

function waitForSocketOpen(socket: WebSocket, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(
      () => fail(new Error("Timed out opening CDP websocket")),
      CDP_SOCKET_TIMEOUT_MS,
    );
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onOpen = () => succeed();
    const onError = () => fail(new Error("Failed to open CDP websocket"));
    const onAbort = () => {
      fail(signal?.reason ?? new Error("CDP websocket opening was cancelled"));
      socket.close();
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

type CdpResponse = {
  id?: unknown;
  result?: unknown;
  error?: unknown;
};

async function cdpCall(
  socket: WebSocket,
  id: number,
  method: string,
  params: Record<string, unknown> | undefined,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(
      () => fail(new Error(`Timed out waiting for ${method}`)),
      CDP_SOCKET_TIMEOUT_MS,
    );
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener("message", listener);
      signal?.removeEventListener("abort", onAbort);
    };
    const succeed = (value: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const listener = (event: MessageEvent) => {
      try {
        const response = JSON.parse(String(event.data)) as CdpResponse;
        if (response.id !== id) {
          return;
        }

        if (response.error !== undefined) {
          fail(new Error(JSON.stringify(response.error)));
          return;
        }
        succeed(response.result);
      } catch (error) {
        fail(error);
      }
    };
    const onAbort = () => fail(signal?.reason ?? new Error(`${method} was cancelled`));

    socket.addEventListener("message", listener);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    try {
      socket.send(JSON.stringify({ id, method, params: params ?? {} }));
    } catch (error) {
      fail(error);
    }
  });
}

function layoutContentSize(value: unknown): { width: number; height: number } | null {
  const root = objectValue(value);
  const contentSize = objectValue(root?.contentSize);
  const width = numberValue(contentSize?.width);
  const height = numberValue(contentSize?.height);
  if (width === null || height === null) {
    return null;
  }
  return { width: Math.ceil(width), height: Math.ceil(height) };
}

function screenshotData(value: unknown): string | null {
  return stringValue(objectValue(value)?.data) || null;
}

async function captureBrowserCdp(
  hint: string,
  format: Format,
  fullPage: boolean,
  signal: AbortSignal | undefined,
): Promise<CaptureResult | string> {
  const errors: string[] = [];
  for (const endpoint of cdpCandidates()) {
    signal?.throwIfAborted();
    const tabs = await fetchTabs(endpoint, signal);
    signal?.throwIfAborted();
    if (typeof tabs === "string") {
      errors.push(`${endpoint}: ${tabs}`);
      continue;
    }

    const tab = pickTab(tabs, hint);
    const webSocketDebuggerUrl =
      typeof tab?.webSocketDebuggerUrl === "string" ? tab.webSocketDebuggerUrl : "";
    if (webSocketDebuggerUrl === "") {
      errors.push(`${endpoint}: no page tab with websocket URL`);
      continue;
    }

    const socket = new WebSocket(webSocketDebuggerUrl);
    let id = 1;
    let metricsOverridden = false;
    try {
      await waitForSocketOpen(socket, signal);
      await cdpCall(socket, id++, "Page.enable", undefined, signal);
      if (fullPage) {
        const metrics = layoutContentSize(
          await cdpCall(socket, id++, "Page.getLayoutMetrics", undefined, signal),
        );
        if (metrics !== null) {
          await cdpCall(
            socket,
            id++,
            "Emulation.setDeviceMetricsOverride",
            {
              width: metrics.width,
              height: metrics.height,
              deviceScaleFactor: 1,
              mobile: false,
            },
            signal,
          );
          metricsOverridden = true;
        }
      }

      const result = await cdpCall(
        socket,
        id++,
        "Page.captureScreenshot",
        {
          format: format === "jpeg" ? "jpeg" : "png",
          fromSurface: true,
          captureBeyondViewport: fullPage,
        },
        signal,
      );
      const data = screenshotData(result);
      if (data === null) {
        errors.push(`${endpoint}: Page.captureScreenshot returned no data`);
        continue;
      }

      const path = await outputPath(format);
      await writeFile(path, Buffer.from(data, "base64"));
      return {
        path,
        method: "browser-cdp",
        target: `${stringValue(tab?.title) || "untitled"} ${stringValue(tab?.url)}`.trim(),
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      errors.push(
        `${endpoint}: ${error instanceof Error ? error.message : "CDP screenshot failed"}`,
      );
    } finally {
      if (metricsOverridden) {
        try {
          await cdpCall(
            socket,
            id++,
            "Emulation.clearDeviceMetricsOverride",
            undefined,
            signalWithTimeout(undefined, CDP_CLEANUP_TIMEOUT_MS),
          );
        } catch (error) {
          errors.push(
            `${endpoint}: failed to clear browser metrics override: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      socket.close();
    }
  }

  return `No usable existing CDP endpoint found. ${errors.join("; ")}`;
}

function formatGeometry(geometry: Geometry): string {
  return `${geometry.x},${geometry.y} ${geometry.width}x${geometry.height}`;
}

function formatWindow(window: WindowInfo): string {
  return `${window.className || window.initialClass || "unknown"} - ${window.title || "untitled"}`;
}

function withFallback(result: CaptureResult, fallback: string[]): CaptureResult {
  return fallback.length === 0 ? result : { ...result, fallback };
}

async function formatResult(
  result: CaptureResult,
  hint: string,
): Promise<AgentToolResult<CaptureResult>> {
  const lines = [`Captured screenshot: ${result.path}`, `Method: ${result.method}`];
  if (result.target !== undefined) lines.push(`Target: ${result.target}`);
  if (result.geometry !== undefined) lines.push(`Geometry: ${formatGeometry(result.geometry)}`);
  if (result.window !== undefined) lines.push(`Window: ${formatWindow(result.window)}`);
  if (hint !== "") lines.push(`Hint: ${hint}`);
  if (result.fallback !== undefined && result.fallback.length > 0) {
    lines.push(`Fallbacks: ${result.fallback.join(" | ")}`);
  }
  const mimeType = result.path.endsWith(".jpg") ? "image/jpeg" : "image/png";
  const data = await readFile(result.path, "base64");
  return {
    content: [
      { type: "text", text: lines.join("\n") },
      { type: "image", data, mimeType },
    ],
    details: result,
  };
}

async function gatherContext(
  cwd: string,
  runCommand: HyprlandCommandRunner,
  signal: AbortSignal | undefined,
): Promise<{
  activeWindow: WindowInfo | null;
  clients: WindowInfo[];
  monitors: Monitor[];
  layers: Layer[];
}> {
  const [activeWindowJson, clientsJson, monitorsJson, layersJson] = await Promise.all([
    hyprctlJson("activewindow", cwd, runCommand, signal),
    hyprctlJson("clients", cwd, runCommand, signal),
    hyprctlJson("monitors", cwd, runCommand, signal),
    hyprctlJson("layers", cwd, runCommand, signal),
  ]);

  return {
    activeWindow: parseWindow(activeWindowJson),
    clients: parseWindows(clientsJson),
    monitors: parseMonitors(monitorsJson),
    layers: collectLayers(layersJson),
  };
}

function diagnosticError(result: CommandResult): string {
  const detail = result.stderr.trim() || result.stdout.trim();
  const firstLine = detail.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (firstLine === "") return `exit code ${result.exitCode}`;
  return firstLine.length <= 300 ? firstLine : `${firstLine.slice(0, 297)}...`;
}

async function runDiagnosticText(
  label: string,
  command: string,
  args: string[],
  cwd: string,
  runCommand: HyprlandCommandRunner,
  signal: AbortSignal | undefined,
  environment?: Readonly<Record<string, string>>,
): Promise<DiagnosticSource<string>> {
  const result = await runCommand(command, args, cwd, signal, environment);
  if (result.exitCode !== 0) {
    return { status: "unavailable", error: `${label}: ${diagnosticError(result)}` };
  }
  return { status: "ok", value: result.stdout.trim() };
}

async function runDiagnosticJson<T>(
  label: string,
  command: string,
  args: string[],
  cwd: string,
  runCommand: HyprlandCommandRunner,
  signal: AbortSignal | undefined,
  parse: (value: unknown) => T | undefined,
  environment?: Readonly<Record<string, string>>,
): Promise<DiagnosticSource<T>> {
  const text = await runDiagnosticText(label, command, args, cwd, runCommand, signal, environment);
  if (text.status === "unavailable") return text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.value);
  } catch {
    return { status: "unavailable", error: `${label}: returned invalid JSON` };
  }

  const value = parse(parsed);
  return value === undefined
    ? { status: "unavailable", error: `${label}: returned unexpected JSON` }
    : { status: "ok", value };
}

function parseDiagnosticWindow(value: unknown): WindowInfo | null | undefined {
  if (value === null) return null;
  const input = objectValue(value);
  if (input === null) return undefined;
  if (Object.keys(input).length === 0) return null;
  return parseWindow(value) ?? undefined;
}

function parseDiagnosticWorkspace(value: unknown): WorkspaceInfo | null | undefined {
  if (value === null) return undefined;
  const input = objectValue(value);
  if (input === null) return undefined;
  if (Object.keys(input).length === 0) return null;
  return parseWorkspace(value) ?? undefined;
}

function parseDiagnosticWindows(value: unknown): WindowInfo[] | undefined {
  return Array.isArray(value) ? parseWindows(value) : undefined;
}

function parseDiagnosticMonitors(value: unknown): Monitor[] | undefined {
  return Array.isArray(value) ? parseMonitors(value) : undefined;
}

function parseDiagnosticLayers(value: unknown): Layer[] | undefined {
  return objectValue(value) !== null || Array.isArray(value) ? collectLayers(value) : undefined;
}

function parseConfigErrors(output: string): string[] {
  const trimmed = output.trim();
  if (trimmed === "" || /^(no (config )?errors found|no errors)$/i.test(trimmed)) return [];
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseProfileStatus(value: unknown): ProfileStatus | undefined {
  const input = objectValue(value);
  if (input === null) return undefined;

  const generation = numberValue(input.generation);
  const resolved = stringValue(input.resolved);
  const selection = stringValue(input.selection);
  if (generation === null || resolved === "" || selection === "") return undefined;

  const sources: Record<string, Record<string, number>> = {};
  const sourceInput = objectValue(input.sources);
  if (sourceInput !== null) {
    for (const [profile, claimsValue] of Object.entries(sourceInput)) {
      const claimsInput = objectValue(claimsValue);
      if (claimsInput === null) continue;
      const claims: Record<string, number> = {};
      for (const [source, count] of Object.entries(claimsInput)) {
        const numericCount = numberValue(count);
        if (numericCount !== null) claims[source] = numericCount;
      }
      sources[profile] = claims;
    }
  }

  return { generation, resolved, selection, sources };
}

type ProcessStatus = WindowCaptureStatus["daemon"];

function isProcessStatus(value: string): value is ProcessStatus {
  return value === "running" || value === "paused" || value === "missing";
}

function parseWindowCaptureStatus(output: string): WindowCaptureStatus | undefined {
  const values: Partial<WindowCaptureStatus> = {};
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (key === "daemon" || key === "worker") {
      if (!isProcessStatus(value)) return undefined;
      values[key] = value;
    }
  }

  return values.daemon !== undefined && values.worker !== undefined
    ? { daemon: values.daemon, worker: values.worker }
    : undefined;
}

function runtimeCommandEnvironment(
  environment: NodeJS.ProcessEnv,
): Readonly<Record<string, string>> | undefined {
  const session = completeHyprlandSessionEnvironment(environment);
  if (session === null) return undefined;
  return {
    ...session,
    ...(environment.HOME === undefined ? {} : { HOME: environment.HOME }),
  };
}

async function runRuntimeDiagnosticText(
  relativePath: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  cwd: string,
  runCommand: HyprlandCommandRunner,
  signal: AbortSignal | undefined,
): Promise<DiagnosticSource<string>> {
  const home = environment.HOME;
  if (home === undefined || home === "") {
    return { status: "unavailable", error: "HOME is unavailable" };
  }
  return runDiagnosticText(
    relativePath,
    join(home, ".config/hypr", relativePath),
    args,
    cwd,
    runCommand,
    signal,
    runtimeCommandEnvironment(environment),
  );
}

async function runRuntimeDiagnosticJson<T>(
  relativePath: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  cwd: string,
  runCommand: HyprlandCommandRunner,
  signal: AbortSignal | undefined,
  parse: (value: unknown) => T | undefined,
): Promise<DiagnosticSource<T>> {
  const home = environment.HOME;
  if (home === undefined || home === "") {
    return { status: "unavailable", error: "HOME is unavailable" };
  }
  return runDiagnosticJson(
    relativePath,
    join(home, ".config/hypr", relativePath),
    args,
    cwd,
    runCommand,
    signal,
    parse,
    runtimeCommandEnvironment(environment),
  );
}

async function runRuntimeDiagnosticAvailability(
  relativePath: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  cwd: string,
  runCommand: HyprlandCommandRunner,
  signal: AbortSignal | undefined,
): Promise<DiagnosticSource<"running" | "stopped">> {
  const home = environment.HOME;
  if (home === undefined || home === "") {
    return { status: "unavailable", error: "HOME is unavailable" };
  }

  const result = await runCommand(
    join(home, ".config/hypr", relativePath),
    args,
    cwd,
    signal,
    runtimeCommandEnvironment(environment),
  );
  if (result.exitCode === 0) return { status: "ok", value: "running" };
  if (result.exitCode === 1) return { status: "ok", value: "stopped" };
  return {
    status: "unavailable",
    error: `${relativePath}: ${diagnosticError(result)}`,
  };
}

function diagnosticValue<T>(
  source: DiagnosticSource<T>,
  name: string,
  fallback: T,
  unavailable: DiagnosticFailure[],
): T {
  if (source.status === "ok") return source.value;
  unavailable.push({ source: name, error: source.error });
  return fallback;
}

async function gatherDesktopDiagnostic(
  environment: NodeJS.ProcessEnv,
  cwd: string,
  runCommand: HyprlandCommandRunner,
  signal: AbortSignal | undefined,
): Promise<HyprlandDiagnosticDetails> {
  const sessionEnvironment = completeHyprlandSessionEnvironment(environment) ?? undefined;
  const [
    activeWindowSource,
    activeWorkspaceSource,
    clientsSource,
    monitorsSource,
    layersSource,
    configErrorsSource,
    profileSource,
    presentationSource,
    windowCaptureSource,
    waybarSource,
  ] = await Promise.all([
    runDiagnosticJson(
      "activewindow",
      "hyprctl",
      ["activewindow", "-j"],
      cwd,
      runCommand,
      signal,
      parseDiagnosticWindow,
      sessionEnvironment,
    ),
    runDiagnosticJson(
      "activeworkspace",
      "hyprctl",
      ["activeworkspace", "-j"],
      cwd,
      runCommand,
      signal,
      parseDiagnosticWorkspace,
      sessionEnvironment,
    ),
    runDiagnosticJson(
      "clients",
      "hyprctl",
      ["clients", "-j"],
      cwd,
      runCommand,
      signal,
      parseDiagnosticWindows,
      sessionEnvironment,
    ),
    runDiagnosticJson(
      "monitors",
      "hyprctl",
      ["monitors", "-j"],
      cwd,
      runCommand,
      signal,
      parseDiagnosticMonitors,
      sessionEnvironment,
    ),
    runDiagnosticJson(
      "layers",
      "hyprctl",
      ["layers", "-j"],
      cwd,
      runCommand,
      signal,
      parseDiagnosticLayers,
      sessionEnvironment,
    ),
    runDiagnosticText(
      "configerrors",
      "hyprctl",
      ["configerrors"],
      cwd,
      runCommand,
      signal,
      sessionEnvironment,
    ),
    runRuntimeDiagnosticJson(
      "runtime/profiles/profilectl.sh",
      ["status", "--json"],
      environment,
      cwd,
      runCommand,
      signal,
      parseProfileStatus,
    ),
    runRuntimeDiagnosticText(
      "runtime/gaming/presentation-status.sh",
      [],
      environment,
      cwd,
      runCommand,
      signal,
    ),
    runRuntimeDiagnosticText(
      "runtime/windows/daemons/window-capture/window-capturectl.sh",
      ["status"],
      environment,
      cwd,
      runCommand,
      signal,
    ),
    runRuntimeDiagnosticAvailability(
      "runtime/desktop/waybar-process.sh",
      ["running"],
      environment,
      cwd,
      runCommand,
      signal,
    ),
  ]);

  const unavailable: DiagnosticFailure[] = [];
  const presentation = diagnosticValue(presentationSource, "presentation", null, unavailable);
  const windowCaptureText = diagnosticValue(
    windowCaptureSource,
    "window-capture",
    null,
    unavailable,
  );
  const waybar = diagnosticValue(waybarSource, "waybar", null, unavailable);

  const windowCapture =
    windowCaptureSource.status === "ok" ? parseWindowCaptureStatus(windowCaptureText ?? "") : null;
  if (windowCaptureSource.status === "ok" && windowCapture === undefined) {
    unavailable.push({
      source: "window-capture",
      error: "returned unexpected status output",
    });
  }
  return {
    timestamp: new Date().toISOString(),
    compositor: {
      activeWindow: diagnosticValue(activeWindowSource, "activewindow", null, unavailable),
      activeWorkspace: diagnosticValue(activeWorkspaceSource, "activeworkspace", null, unavailable),
      clients: diagnosticValue(clientsSource, "clients", [], unavailable),
      monitors: diagnosticValue(monitorsSource, "monitors", [], unavailable),
      layers: diagnosticValue(layersSource, "layers", [], unavailable),
      configErrors:
        configErrorsSource.status === "ok"
          ? parseConfigErrors(configErrorsSource.value)
          : diagnosticValue(configErrorsSource, "configerrors", null, unavailable),
    },
    runtime: {
      profile: diagnosticValue(profileSource, "profile", null, unavailable),
      presentation,
      windowCapture: windowCapture ?? null,
      waybar,
    },
    unavailable,
  };
}

const MAX_DIAGNOSTIC_CLIENT_LINES = 40;
const MAX_DIAGNOSTIC_LAYER_LINES = 40;
const MAX_DIAGNOSTIC_CONFIG_ERROR_LINES = 40;
const MAX_DIAGNOSTIC_PRESENTATION_LINES = 40;
const MAX_DIAGNOSTIC_CLAIMS = 40;
const MAX_DIAGNOSTIC_FIELD_CHARS = 240;

function diagnosticField(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= MAX_DIAGNOSTIC_FIELD_CHARS
    ? compact
    : `${compact.slice(0, MAX_DIAGNOSTIC_FIELD_CHARS - 3).trimEnd()}...`;
}

function formatDiagnosticWindow(window: WindowInfo): string {
  const application = diagnosticField(window.className || window.initialClass || "unknown");
  const title = diagnosticField(window.title || "untitled");
  return `${application} - ${title}`;
}

function formatWorkspace(workspace: WorkspaceInfo | null): string {
  if (workspace === null) return "unknown";
  const name = diagnosticField(workspace.name);
  const identity = name || (workspace.id === null ? "unnamed" : `#${workspace.id}`);
  const monitor = diagnosticField(workspace.monitor);
  return monitor === "" ? identity : `${identity} on ${monitor}`;
}

function formatDesktopDiagnostic(details: HyprlandDiagnosticDetails): string {
  const { compositor, runtime } = details;
  const lines = [`Hyprland desktop diagnostic (${details.timestamp})`, ""];
  lines.push(`Active workspace: ${formatWorkspace(compositor.activeWorkspace)}`);
  lines.push(
    `Active window: ${compositor.activeWindow === null ? "none" : formatDiagnosticWindow(compositor.activeWindow)}`,
  );
  lines.push("");

  lines.push(`Monitors (${compositor.monitors.length}):`);
  for (const monitor of compositor.monitors) {
    lines.push(
      `- ${diagnosticField(monitor.name)} ${formatGeometry(monitor)}${monitor.focused ? " [focused]" : ""}`,
    );
  }
  if (compositor.monitors.length === 0) lines.push("- none");
  lines.push("");

  lines.push(`Clients (${compositor.clients.length}):`);
  for (const client of compositor.clients.slice(0, MAX_DIAGNOSTIC_CLIENT_LINES)) {
    const geometry =
      client.position !== null && client.size !== null
        ? ` @ ${client.position[0]},${client.position[1]} ${client.size[0]}x${client.size[1]}`
        : "";
    lines.push(
      `- ${formatDiagnosticWindow(client)} [${formatWorkspace(client.workspace)}]${geometry}`,
    );
  }
  if (compositor.clients.length === 0) lines.push("- none");
  if (compositor.clients.length > MAX_DIAGNOSTIC_CLIENT_LINES) {
    lines.push(
      `- ... ${compositor.clients.length - MAX_DIAGNOSTIC_CLIENT_LINES} more clients omitted`,
    );
  }
  lines.push("");

  lines.push(`Layers (${compositor.layers.length}):`);
  for (const layer of compositor.layers.slice(0, MAX_DIAGNOSTIC_LAYER_LINES)) {
    lines.push(
      `- ${diagnosticField(layer.namespace)} [${diagnosticField(layer.level)}] on ${diagnosticField(layer.monitor || "unknown monitor")} @ ${formatGeometry(layer)}`,
    );
  }
  if (compositor.layers.length === 0) lines.push("- none");
  if (compositor.layers.length > MAX_DIAGNOSTIC_LAYER_LINES) {
    lines.push(
      `- ... ${compositor.layers.length - MAX_DIAGNOSTIC_LAYER_LINES} more layers omitted`,
    );
  }
  lines.push("");

  if (compositor.configErrors === null) {
    lines.push("Config errors: unavailable");
  } else if (compositor.configErrors.length === 0) {
    lines.push("Config errors: none");
  } else {
    const errors = compositor.configErrors.slice(0, MAX_DIAGNOSTIC_CONFIG_ERROR_LINES);
    lines.push(`Config errors (${compositor.configErrors.length}):`);
    for (const error of errors) {
      lines.push(`- ${diagnosticField(error)}`);
    }
    if (compositor.configErrors.length > MAX_DIAGNOSTIC_CONFIG_ERROR_LINES) {
      lines.push(
        `- ... ${compositor.configErrors.length - MAX_DIAGNOSTIC_CONFIG_ERROR_LINES} more config errors omitted`,
      );
    }
  }
  lines.push("");

  lines.push("Runtime:");
  if (runtime.profile === null) {
    lines.push("- Profile: unavailable");
  } else {
    const allClaims = Object.entries(runtime.profile.sources).flatMap(([profile, sources]) =>
      Object.entries(sources).map(
        ([source, count]) => `${diagnosticField(profile)}/${diagnosticField(source)}=${count}`,
      ),
    );
    const claims = allClaims.slice(0, MAX_DIAGNOSTIC_CLAIMS);
    lines.push(
      `- Profile: resolved=${diagnosticField(runtime.profile.resolved)}, selection=${diagnosticField(runtime.profile.selection)}, generation=${runtime.profile.generation}`,
    );
    lines.push(`  Claims: ${claims.length === 0 ? "none" : claims.join(", ")}`);
    if (allClaims.length > MAX_DIAGNOSTIC_CLAIMS) {
      lines.push(`  ... ${allClaims.length - MAX_DIAGNOSTIC_CLAIMS} more claims omitted`);
    }
  }
  if (runtime.presentation === null) {
    lines.push("- Presentation: unavailable");
  } else {
    const presentationLines = runtime.presentation.split(/\r?\n/);
    lines.push("- Presentation:");
    if (runtime.presentation === "") {
      lines.push("  (no details)");
    } else {
      for (const line of presentationLines.slice(0, MAX_DIAGNOSTIC_PRESENTATION_LINES)) {
        lines.push(`  ${diagnosticField(line)}`);
      }
      if (presentationLines.length > MAX_DIAGNOSTIC_PRESENTATION_LINES) {
        lines.push(
          `  ... ${presentationLines.length - MAX_DIAGNOSTIC_PRESENTATION_LINES} more presentation lines omitted`,
        );
      }
    }
  }
  lines.push(
    `- Window capture: ${runtime.windowCapture === null ? "unavailable" : `daemon=${runtime.windowCapture.daemon}, worker=${runtime.windowCapture.worker}`}`,
  );
  lines.push(`- Waybar: ${runtime.waybar ?? "unavailable"}`);

  if (details.unavailable.length > 0) {
    lines.push("", "Unavailable sources:");
    lines.push(...details.unavailable.map(({ source, error }) => `- ${source}: ${error}`));
  }

  const output = lines.join("\n");
  const truncated = truncateHead(output, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  return truncated.truncated
    ? `${truncated.content}\n\n[Diagnostic output truncated; structured details retain the remaining parsed state.]`
    : truncated.content;
}

const HyprDesktopDiagnoseParameters = Type.Object({});

function createHyprDesktopDiagnoseTool(
  runCommand: HyprlandCommandRunner,
  environment: NodeJS.ProcessEnv,
) {
  return defineTool<typeof HyprDesktopDiagnoseParameters, HyprlandDiagnosticDetails>({
    name: "hypr_desktop_diagnose",
    label: "Hyprland Desktop Diagnostic",
    description:
      "Collect a read-only Hyprland desktop diagnostic snapshot, including compositor state, config errors, profile state, presentation state, window capture status, and Waybar availability.",
    promptSnippet: "Inspect the current Hyprland desktop and runtime health",
    promptGuidelines: [
      "Use hypr_desktop_diagnose when diagnosing Hyprland configuration or runtime behavior before running separate state queries.",
      "Treat unavailable diagnostic sources as unknown; do not infer that an unavailable component is healthy.",
    ],
    parameters: HyprDesktopDiagnoseParameters,
    executionMode: "sequential",

    async execute(_toolCallId, _args, signal, _onUpdate, ctx) {
      if (supportsHyprlandSession(environment) === false) {
        throw new Error(
          "Hyprland session variables are unavailable; this tool requires HYPRLAND_INSTANCE_SIGNATURE, XDG_RUNTIME_DIR, and WAYLAND_DISPLAY.",
        );
      }

      const details = await gatherDesktopDiagnostic(environment, ctx.cwd, runCommand, signal);
      return {
        content: [{ type: "text", text: formatDesktopDiagnostic(details) }],
        details,
      };
    },
  });
}

async function captureByMode(
  args: { mode: Mode; hint: string; format: Format; fullPage: boolean; region?: Geometry },
  cwd: string,
  runCommand: HyprlandCommandRunner,
  signal: AbortSignal | undefined,
): Promise<CaptureResult | string> {
  if (args.region !== undefined) {
    return captureRegion(args.region, "explicit coordinates", args.format, cwd, runCommand, signal);
  }

  const context = await gatherContext(cwd, runCommand, signal);
  const monitor = focusedMonitor(context.monitors, context.activeWindow);
  const targetWindow = windowForHint(context.activeWindow, context.clients, args.hint);
  const fallback: string[] = [];

  if (args.mode === "browser" || (args.mode === "auto" && isBrowserWindow(targetWindow))) {
    if (isChromiumWindow(targetWindow) || args.mode === "browser") {
      const browserResult = await captureBrowserCdp(args.hint, args.format, args.fullPage, signal);
      if (typeof browserResult !== "string") {
        return withFallback(browserResult, fallback);
      }

      if (args.mode === "browser") {
        return `ERROR: ${browserResult}`;
      }
      fallback.push(`browser-cdp failed: ${browserResult}`);
    }
  }

  if (args.mode === "window") {
    const result = await captureWindow(targetWindow, args.format, cwd, runCommand, signal);
    return typeof result === "string" ? `ERROR: ${result}` : withFallback(result, fallback);
  }

  if (args.mode === "region") {
    const inferred = inferContextRegion(args.hint, context.layers, monitor);
    if (inferred === null) {
      return "ERROR: Could not infer a region from hint.";
    }

    const result = await captureRegion(
      inferred.geometry,
      inferred.target,
      args.format,
      cwd,
      runCommand,
      signal,
    );
    return typeof result === "string" ? `ERROR: ${result}` : withFallback(result, fallback);
  }

  if (args.mode === "monitor") {
    const result = await captureMonitor(monitor, args.format, cwd, runCommand, signal);
    return typeof result === "string" ? `ERROR: ${result}` : withFallback(result, fallback);
  }

  if (args.mode === "full") {
    const result = await captureFull(args.format, cwd, runCommand, signal);
    return typeof result === "string" ? `ERROR: ${result}` : withFallback(result, fallback);
  }

  if (looksLikeWidgetHint(args.hint)) {
    const inferred = inferContextRegion(args.hint, context.layers, monitor);
    if (inferred !== null) {
      const result = await captureRegion(
        inferred.geometry,
        inferred.target,
        args.format,
        cwd,
        runCommand,
        signal,
      );
      if (typeof result !== "string") {
        return withFallback(result, fallback);
      }
      fallback.push(`region failed: ${result}`);
    }
  }

  const windowResult = await captureWindow(targetWindow, args.format, cwd, runCommand, signal);
  if (typeof windowResult !== "string") {
    return withFallback(windowResult, fallback);
  }
  fallback.push(`window failed: ${windowResult}`);

  const monitorResult = await captureMonitor(monitor, args.format, cwd, runCommand, signal);
  if (typeof monitorResult !== "string") {
    return withFallback(monitorResult, fallback);
  }
  fallback.push(`monitor failed: ${monitorResult}`);

  const fullResult = await captureFull(args.format, cwd, runCommand, signal);
  return typeof fullResult === "string"
    ? `ERROR: ${fullResult}`
    : withFallback(fullResult, fallback);
}

const ModeSchema = StringEnum(["auto", "browser", "window", "region", "monitor", "full"] as const);
const FormatSchema = StringEnum(["png", "jpeg"] as const);
const HyprWindowScreenshotParameters = Type.Object({
  hint: Type.Optional(
    Type.String({
      description:
        "Natural-language target hint, e.g. 'calendar popup above bottom bar' or 'current browser page'.",
    }),
  ),
  mode: Type.Optional(ModeSchema),
  region: Type.Optional(
    Type.Object(
      {
        x: Type.Integer({ description: "Left compositor coordinate; may be negative." }),
        y: Type.Integer({ description: "Top compositor coordinate; may be negative." }),
        width: Type.Integer({ minimum: 1, description: "Capture width in pixels." }),
        height: Type.Integer({ minimum: 1, description: "Capture height in pixels." }),
      },
      { description: "Exact compositor region to capture." },
    ),
  ),
  format: Type.Optional(FormatSchema),
  fullPage: Type.Optional(
    Type.Boolean({ description: "For browser CDP captures, request a full-page screenshot." }),
  ),
});

function createHyprWindowScreenshotTool(
  runCommand: HyprlandCommandRunner,
  environment: NodeJS.ProcessEnv,
) {
  return defineTool<typeof HyprWindowScreenshotParameters, CaptureResult>({
    name: "hypr_window_screenshot",
    label: "Hyprland Screenshot",
    description:
      "Capture a Wayland/Hyprland screenshot. Prefer explicit region coordinates and the smallest useful area when bounds are known; otherwise use browser CDP or contextual grim fallbacks.",
    promptSnippet: "Capture a contextual screenshot from the Hyprland desktop",
    promptGuidelines: [
      "Use hypr_window_screenshot for visual context from the current Hyprland desktop.",
      "Prefer an explicit region or the smallest useful capture mode when the target bounds are known.",
    ],
    parameters: HyprWindowScreenshotParameters,
    // Timestamp-derived output paths can collide when captures run concurrently.
    executionMode: "sequential",

    async execute(_toolCallId, args, signal, _onUpdate, ctx) {
      if (supportsHyprlandSession(environment) === false) {
        throw new Error(
          "Hyprland session variables are unavailable; this tool requires HYPRLAND_INSTANCE_SIGNATURE, XDG_RUNTIME_DIR, and WAYLAND_DISPLAY.",
        );
      }

      const mode = args.mode ?? "auto";
      const format = args.format ?? "png";
      const hint = args.hint ?? "";
      const captureArgs = {
        mode,
        hint,
        format,
        fullPage: args.fullPage ?? false,
        ...(args.region === undefined ? {} : { region: args.region }),
      };
      const result = await captureByMode(captureArgs, ctx.cwd, runCommand, signal);
      if (typeof result === "string") {
        throw new Error(result);
      }
      return formatResult(result, hint);
    },
  });
}

const HYPRPROP_COMMAND = "hyprprop";
const HYPRPROP_ARGS = ["--raw"];
const HYPRPROP_COMPACT_FIELDS = [
  "address",
  "at",
  "size",
  "workspace",
  "monitor",
  "class",
  "title",
  "pid",
  "floating",
  "pinned",
  "fullscreen",
  "tags",
  "contentType",
  "stableId",
  "hidden",
  "mapped",
  "visible",
  "acceptsInput",
  "xwayland",
];
const HYPRPROP_DEFAULT_BOOLEAN_VALUES: Readonly<Record<string, boolean>> = {
  hidden: false,
  mapped: true,
  visible: true,
  acceptsInput: true,
  floating: false,
  pinned: false,
  xwayland: false,
};

type HyprPropMode = "compact" | "raw";

function parseHyprPropMode(args: string): HyprPropMode | null {
  const mode = args.trim();
  if (mode === "" || mode === "compact") return "compact";
  if (mode === "raw" || mode === "--raw") return "raw";
  return null;
}

function isCompactHyprPropValue(key: string, value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") {
    return value !== "" && !(key === "contentType" && value === "none");
  }
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") {
    const defaultValue = HYPRPROP_DEFAULT_BOOLEAN_VALUES[key];
    return defaultValue === undefined || value !== defaultValue;
  }
  if (key === "fullscreen" && value === 0) return false;
  return true;
}

function compactHyprPropOutput(output: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("hyprprop returned invalid JSON");
  }
  const properties = objectValue(parsed);
  if (properties === null) throw new Error("hyprprop returned a JSON value instead of an object");
  const compactProperties = Object.fromEntries(
    HYPRPROP_COMPACT_FIELDS.flatMap((key) => {
      const value = properties[key];
      return isCompactHyprPropValue(key, value) ? [[key, value]] : [];
    }),
  );
  return JSON.stringify(compactProperties);
}

function hyprPropMessage(output: string, mode: HyprPropMode): string {
  const description =
    mode === "raw"
      ? "Here is the selected window's raw JSON:"
      : "Here are the selected window's compact properties:";
  return [
    `The \`hyprprop\` window selection completed. ${description}`,
    "",
    "```json",
    output,
    "```",
  ].join("\n");
}
type HyprlandSessionEnvironment = {
  readonly HYPRLAND_INSTANCE_SIGNATURE: string;
  readonly XDG_RUNTIME_DIR: string;
  readonly WAYLAND_DISPLAY: string;
};

function completeHyprlandSessionEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): HyprlandSessionEnvironment | null {
  const signature = environment.HYPRLAND_INSTANCE_SIGNATURE;
  const runtimeDirectory = environment.XDG_RUNTIME_DIR;
  const waylandDisplay = environment.WAYLAND_DISPLAY;
  if (signature === undefined || signature === "") return null;
  if (runtimeDirectory === undefined || runtimeDirectory === "") return null;
  if (waylandDisplay === undefined || waylandDisplay === "") return null;
  return {
    HYPRLAND_INSTANCE_SIGNATURE: signature,
    XDG_RUNTIME_DIR: runtimeDirectory,
    WAYLAND_DISPLAY: waylandDisplay,
  };
}

function parseHyprlandSessionEnvironment(output: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (value === "") continue;
    switch (name) {
      case "HYPRLAND_INSTANCE_SIGNATURE":
        environment.HYPRLAND_INSTANCE_SIGNATURE = value;
        break;
      case "XDG_RUNTIME_DIR":
        environment.XDG_RUNTIME_DIR = value;
        break;
      case "WAYLAND_DISPLAY":
        environment.WAYLAND_DISPLAY = value;
        break;
    }
  }
  return environment;
}

async function resolveHyprlandSessionEnvironment(
  environment: NodeJS.ProcessEnv,
  cwd: string,
  runCommand: HyprlandCommandRunner,
): Promise<HyprlandSessionEnvironment | null> {
  // Neovim and Pi can outlive Hyprland startup or replacement, so refresh missing values from UWSM's user environment.
  const inherited = completeHyprlandSessionEnvironment(environment);
  if (inherited !== null) return inherited;

  const result = await runCommand("systemctl", ["--user", "show-environment"], cwd);
  if (result.exitCode !== 0) return null;
  return completeHyprlandSessionEnvironment({
    ...environment,
    ...parseHyprlandSessionEnvironment(result.stdout),
  });
}

function registerHyprPropCommand(
  pi: ExtensionAPI,
  environment: NodeJS.ProcessEnv,
  runCommand: HyprlandCommandRunner,
): void {
  pi.registerCommand("hypr-prop", {
    description: "Select a Hyprland window and send its properties to the agent",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const mode = parseHyprPropMode(args);
      if (mode === null) {
        ctx.ui.notify("Usage: /hypr-prop [compact|raw]", "error");
        return;
      }

      if (ctx.isIdle() === false) {
        ctx.ui.notify("The agent is busy; run /hypr-prop when it is idle.", "warning");
        return;
      }

      let sessionEnvironment: HyprlandSessionEnvironment | null;
      try {
        sessionEnvironment = await resolveHyprlandSessionEnvironment(
          environment,
          ctx.cwd,
          runCommand,
        );
      } catch (error) {
        ctx.ui.notify(
          `Could not resolve the active Hyprland environment: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return;
      }
      if (sessionEnvironment === null) {
        ctx.ui.notify(
          "Pi could not access the active Hyprland environment; restart Pi from the current desktop session and try again.",
          "error",
        );
        return;
      }

      let result: CommandResult;
      try {
        result = await runCommand(
          HYPRPROP_COMMAND,
          HYPRPROP_ARGS,
          ctx.cwd,
          undefined,
          sessionEnvironment,
        );
      } catch (error) {
        ctx.ui.notify(
          `hyprprop failed: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return;
      }

      if (result.exitCode !== 0) {
        const detail =
          result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
        ctx.ui.notify(`hyprprop failed: ${detail}`, "error");
        return;
      }
      const rawOutput = result.stdout.trim();
      if (rawOutput === "") {
        ctx.ui.notify("No window was selected.", "warning");
        return;
      }

      let output = rawOutput;
      if (mode === "compact") {
        try {
          output = compactHyprPropOutput(rawOutput);
        } catch (error) {
          ctx.ui.notify(
            `Could not compact hyprprop results: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
          return;
        }
      }

      try {
        pi.sendUserMessage(hyprPropMessage(output, mode), { expandPromptTemplates: false });
      } catch (error) {
        ctx.ui.notify(
          `Could not send hyprprop results to the agent: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      }
    },
  });
}

export function supportsHyprlandSession(environment: NodeJS.ProcessEnv = process.env): boolean {
  return completeHyprlandSessionEnvironment(environment) !== null;
}

export interface HyprlandExtensionOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly commandRunner?: HyprlandCommandRunner;
}

export function registerHyprlandExtension(
  pi: ExtensionAPI,
  options: HyprlandExtensionOptions = {},
): void {
  const environment = options.environment ?? process.env;
  const commandRunner = options.commandRunner ?? createCommandRunner(pi);
  registerHyprPropCommand(pi, environment, commandRunner);
  if (supportsHyprlandSession(environment) === false) return;
  const runCommand = options.commandRunner ?? createCommandRunner(pi, COMMAND_TIMEOUT_MS);
  pi.registerTool(createHyprDesktopDiagnoseTool(runCommand, environment));
  pi.registerTool(createHyprWindowScreenshotTool(runCommand, environment));
}

export default function hyprlandExtension(pi: ExtensionAPI): void {
  registerHyprlandExtension(pi);
}
