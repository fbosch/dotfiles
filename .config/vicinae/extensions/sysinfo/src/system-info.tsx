import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  Action,
  ActionPanel,
  Cache,
  Clipboard,
  Detail,
  Icon,
  Toast,
  environment,
  getPreferenceValues,
  showToast,
} from "@vicinae/api";
import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { generateSystemInfoSVG, svgToDataUri } from "./svg-generator";
import type { DynamicSystemInfo, Preferences, StaticSystemInfo } from "./types";

const execAsync = promisify(exec);

// Vicinae Cache for static system info persistence between sessions
const cache = new Cache();
const STATIC_INFO_CACHE_KEY = "static-system-info-v1";
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

type CachedStaticInfo = {
  info: StaticSystemInfo;
  cachedAt: number;
};

function getCachedStaticInfo(): StaticSystemInfo | null {
  const cached = cache.get(STATIC_INFO_CACHE_KEY);
  if (!cached) return null;
  try {
    const data: CachedStaticInfo = JSON.parse(cached);
    if (Date.now() - data.cachedAt < CACHE_DURATION) {
      return data.info;
    }
    cache.remove(STATIC_INFO_CACHE_KEY);
    return null;
  } catch {
    cache.remove(STATIC_INFO_CACHE_KEY);
    return null;
  }
}

function setCachedStaticInfo(info: StaticSystemInfo): void {
  cache.set(
    STATIC_INFO_CACHE_KEY,
    JSON.stringify({ info, cachedAt: Date.now() } satisfies CachedStaticInfo),
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Static system info - things that don't change during runtime
async function getStaticSystemInfo(): Promise<StaticSystemInfo> {
  const [hostname, osInfo, cpuInfo, gpuInfo, displayInfo] = await Promise.all([
    execAsync("hostname").then((r) => r.stdout.trim()),
    getOSInfo(),
    getCPUInfo(),
    getGPUInfo(),
    getDisplayInfo(),
  ]);

  const info: StaticSystemInfo = {
    hostname,
    model: osInfo.model,
    cpu: cpuInfo,
    gpu: gpuInfo,
    displays: displayInfo,
    os: {
      name: osInfo.osName,
      version: osInfo.osVersion,
      kernel: osInfo.kernel,
      architecture: osInfo.architecture,
    },
  };

  // Cache static info for future opens
  setCachedStaticInfo(info);
  
  return info;
}

// Dynamic system info - things that change frequently
async function getDynamicSystemInfo(): Promise<DynamicSystemInfo> {
  const [memInfo, swapInfo, storageInfo, uptimeInfo] = await Promise.all([
    getMemoryInfo(),
    getSwapInfo(),
    getStorageInfo(),
    getUptime(),
  ]);

  return {
    memory: memInfo,
    swap: swapInfo,
    storage: storageInfo,
    uptime: uptimeInfo,
  };
}

async function getOSInfo() {
  try {
    // Try to get pretty name from os-release
    const osRelease = await readFile("/etc/os-release", "utf-8");
    const prettyName =
      osRelease.match(/PRETTY_NAME="([^"]+)"/)?.[1] || "Linux";
    const versionId = osRelease.match(/VERSION_ID="([^"]+)"/)?.[1] || "";

    const kernel = await execAsync("uname -r").then((r) => r.stdout.trim());
    const arch = await execAsync("uname -m").then((r) => r.stdout.trim());

    // Try to get model info
    let model: string | undefined;
    try {
      const productName = await readFile(
        "/sys/devices/virtual/dmi/id/product_name",
        "utf-8",
      ).then((s) => s.trim());
      const productVersion = await readFile(
        "/sys/devices/virtual/dmi/id/product_version",
        "utf-8",
      ).then((s) => s.trim());
      model =
        productVersion && productVersion !== "None"
          ? `${productName} ${productVersion}`
          : productName;
    } catch {
      // Not available, likely a VM or unsupported system
    }

    return {
      osName: prettyName,
      osVersion: versionId,
      kernel,
      architecture: arch,
      model,
    };
  } catch {
    // Fallback
    const uname = await execAsync("uname -a").then((r) => r.stdout.trim());
    return {
      osName: "Linux",
      osVersion: "",
      kernel: uname,
      architecture: "unknown",
    };
  }
}

async function getCPUInfo() {
  try {
    const cpuinfo = await readFile("/proc/cpuinfo", "utf-8");
    const modelMatch = cpuinfo.match(/model name\s*:\s*(.+)/);
    const cpuName = modelMatch ? modelMatch[1].trim() : "Unknown CPU";

    // Count physical cores and threads
    const coreIds = new Set<string>();
    const processors = cpuinfo.match(/processor\s*:/g)?.length || 1;

    for (const line of cpuinfo.split("\n")) {
      if (line.startsWith("core id")) {
        coreIds.add(line);
      }
    }

    const cores = coreIds.size || processors;

    // Try to get CPU frequency
    let speed: string | undefined;
    try {
      const freq = await readFile(
        "/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq",
        "utf-8",
      );
      const ghz = (Number.parseInt(freq.trim(), 10) / 1000000).toFixed(2);
      speed = `${ghz} GHz`;
    } catch {
      // Frequency scaling might not be available
    }

    return {
      name: cpuName,
      cores,
      threads: processors,
      speed,
    };
  } catch {
    return {
      name: "Unknown CPU",
      cores: 1,
      threads: 1,
    };
  }
}

async function getMemoryInfo() {
  try {
    const meminfo = await readFile("/proc/meminfo", "utf-8");
    const total =
      Number.parseInt(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] || "0", 10) * 1024;
    const available =
      Number.parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] || "0", 10) *
      1024;
    const used = total - available;
    const usagePercent = total > 0 ? (used / total) * 100 : 0;

    return {
      total,
      used,
      available,
      usagePercent,
    };
  } catch {
    return {
      total: 0,
      used: 0,
      available: 0,
      usagePercent: 0,
    };
  }
}

async function getSwapInfo() {
  try {
    const meminfo = await readFile("/proc/meminfo", "utf-8");
    const total =
      Number.parseInt(meminfo.match(/SwapTotal:\s+(\d+)/)?.[1] || "0", 10) * 1024;
    const free =
      Number.parseInt(meminfo.match(/SwapFree:\s+(\d+)/)?.[1] || "0", 10) * 1024;
    const used = total - free;
    const usagePercent = total > 0 ? (used / total) * 100 : 0;

    return {
      total,
      used,
      free,
      usagePercent,
    };
  } catch {
    return {
      total: 0,
      used: 0,
      free: 0,
      usagePercent: 0,
    };
  }
}

async function getStorageInfo() {
  try {
    const { stdout } = await execAsync(
      "df -B1 / /home 2>/dev/null | tail -n +2",
    );
    const lines = stdout.trim().split("\n");
    const devices = new Set<string>();

    return lines
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) return null;

        const [device, totalStr, usedStr, availStr, , mountPoint] = parts;

        // Skip duplicate mount points
        if (devices.has(device)) return null;
        devices.add(device);

        const total = Number.parseInt(totalStr, 10);
        const used = Number.parseInt(usedStr, 10);
        const available = Number.parseInt(availStr, 10);
        const usagePercent = total > 0 ? (used / total) * 100 : 0;

        return {
          name: device,
          mountPoint,
          total,
          used,
          available,
          usagePercent,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
  } catch {
    return [];
  }
}

async function getGPUInfo() {
  try {
    // Try lspci first
    const { stdout } = await execAsync(
      "lspci | grep -i 'vga\\|3d\\|display'",
    );
    const firstGPU = stdout.split("\n")[0];
    if (firstGPU) {
      // Extract GPU name from lspci output
      const match = firstGPU.match(/: (.+)/);
      if (match) {
        return { name: match[1].trim() };
      }
    }
  } catch {
    // lspci might not be available
  }

  return undefined;
}

async function getUptime() {
  try {
    const uptimeStr = await readFile("/proc/uptime", "utf-8");
    return Number.parseFloat(uptimeStr.split(" ")[0]);
  } catch {
    return 0;
  }
}

async function getDisplayInfo() {
  try {
    // Try to get display info from Hyprland if available
    const { stdout } = await execAsync("hyprctl monitors -j");
    type HyprMonitor = {
      name: string;
      width: number;
      height: number;
      refreshRate: number;
      scale: number;
    };
    const monitors = JSON.parse(stdout) as HyprMonitor[];

    return monitors.map((m) => ({
      name: m.name || "Unknown",
      resolution: `${m.width}×${m.height}`,
      refreshRate: m.refreshRate,
      scale: m.scale,
    }));
  } catch {
    // Hyprland not available, try xrandr
    try {
      const { stdout } = await execAsync("xrandr --current");
      const displays = [];
      const lines = stdout.split("\n");

      for (const line of lines) {
        if (line.includes(" connected")) {
          const match = line.match(/^(\S+)\s+connected.*?(\d+x\d+)/);
          if (match) {
            displays.push({
              name: match[1],
              resolution: match[2].replace("x", "×"),
            });
          }
        }
      }

      return displays.length > 0 ? displays : undefined;
    } catch {
      return undefined;
    }
  }
}

function SystemInfoContent() {
  const preferences = getPreferenceValues<Preferences>();
  const refreshInterval = Number.parseInt(preferences.refreshInterval, 10);

  // Static system info - load from cache first, then refresh in background
  const {
    data: staticInfo,
  } = useQuery({
    queryKey: ["system-info-static"],
    queryFn: getStaticSystemInfo,
    staleTime: 60 * 60 * 1000, // 1 hour in react-query cache
    initialData: () => getCachedStaticInfo() || undefined, // Load from persistent cache immediately
    throwOnError: (error) => {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to load system info",
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return false;
    },
  });

  // Dynamic system info - refreshed frequently (memory, storage usage)
  const {
    data: dynamicInfo,
    refetch: refetchDynamic,
  } = useQuery({
    queryKey: ["system-info-dynamic"],
    queryFn: getDynamicSystemInfo,
    staleTime: 5000, // 5 seconds
    enabled: !!staticInfo, // Only fetch dynamic info after static info is loaded
    refetchInterval: refreshInterval > 0 ? refreshInterval : false, // Auto-refresh based on preference
    throwOnError: (error) => {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to load usage data",
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return false;
    },
  });

  // If we don't have static info yet, show loading state
  if (!staticInfo) {
    return <Detail markdown="Loading system information..." />;
  }

  // If we don't have dynamic info yet, show loading with static info in sidebar
  if (!dynamicInfo) {
    return (
      <Detail
        markdown="Loading usage data..."
        metadata={
          <Detail.Metadata>
            <Detail.Metadata.Label
              title="Computer Name"
              text={staticInfo.hostname}
              icon={Icon.ComputerChip}
            />
            {staticInfo.model && (
              <Detail.Metadata.Label title="Model" text={staticInfo.model} />
            )}
            <Detail.Metadata.Separator />
            <Detail.Metadata.Label
              title="Processor"
              text={staticInfo.cpu.name}
              icon={Icon.ComputerChip}
            />
            <Detail.Metadata.Label
              title="Cores"
              text={`${staticInfo.cpu.cores}C / ${staticInfo.cpu.threads}T`}
            />
            {staticInfo.gpu && (
              <>
                <Detail.Metadata.Separator />
                <Detail.Metadata.Label
                  title="Graphics"
                  text={staticInfo.gpu.name}
                  icon={Icon.Desktop}
                />
              </>
            )}
            {staticInfo.displays && staticInfo.displays.length > 0 && (
              <>
                <Detail.Metadata.Separator />
                {staticInfo.displays.map((display, index) => (
                  <Detail.Metadata.Label
                    key={index}
                    title={index === 0 ? "Display" : `Display ${index + 1}`}
                    text={`${display.resolution}${display.refreshRate ? ` @ ${display.refreshRate.toFixed(0)}Hz` : ""}`}
                    icon={index === 0 ? Icon.Monitor : undefined}
                  />
                ))}
              </>
            )}
            <Detail.Metadata.Separator />
            <Detail.Metadata.Label
              title="Kernel"
              text={staticInfo.os.kernel}
              icon={Icon.Terminal}
            />
            <Detail.Metadata.Label
              title="Architecture"
              text={staticInfo.os.architecture}
            />
          </Detail.Metadata>
        }
      />
    );
  }

  // Combine static and dynamic info for SVG generation
  const combinedInfo = {
    ...staticInfo,
    memory: dynamicInfo.memory,
    swap: dynamicInfo.swap,
    storage: dynamicInfo.storage,
    os: {
      ...staticInfo.os,
      uptime: dynamicInfo.uptime,
    },
  };

  // Generate SVG with current theme appearance and convert to data URI
  const svg = generateSystemInfoSVG(combinedInfo, environment.appearance);
  const dataUri = svgToDataUri(svg);
  const markdown = `![System Information](${dataUri})`;

  return (
    <Detail
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label
            title="Computer Name"
            text={staticInfo.hostname}
            icon={Icon.ComputerChip}
          />
          {staticInfo.model && (
            <Detail.Metadata.Label title="Model" text={staticInfo.model} />
          )}
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Processor"
            text={staticInfo.cpu.name}
            icon={Icon.ComputerChip}
          />
          <Detail.Metadata.Label
            title="Cores"
            text={`${staticInfo.cpu.cores}C / ${staticInfo.cpu.threads}T`}
          />
          {staticInfo.gpu && (
            <>
              <Detail.Metadata.Separator />
              <Detail.Metadata.Label
                title="Graphics"
                text={staticInfo.gpu.name}
                icon={Icon.Desktop}
              />
            </>
          )}
          {staticInfo.displays && staticInfo.displays.length > 0 && (
            <>
              <Detail.Metadata.Separator />
              {staticInfo.displays.map((display, index) => (
                <Detail.Metadata.Label
                  key={index}
                  title={index === 0 ? "Display" : `Display ${index + 1}`}
                  text={`${display.resolution}${display.refreshRate ? ` @ ${display.refreshRate.toFixed(0)}Hz` : ""}`}
                  icon={index === 0 ? Icon.Monitor : undefined}
                />
              ))}
            </>
          )}
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Kernel"
            text={staticInfo.os.kernel}
            icon={Icon.Terminal}
          />
          <Detail.Metadata.Label
            title="Architecture"
            text={staticInfo.os.architecture}
          />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action
            title="Refresh"
            icon={Icon.ArrowClockwise}
            onAction={() => refetchDynamic()}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
          />
          <ActionPanel.Section>
            <Action
              title="Copy Hostname"
              icon={Icon.Clipboard}
              onAction={async () => {
                await Clipboard.copy(staticInfo.hostname);
                await showToast({
                  style: Toast.Style.Success,
                  title: "Copied Hostname",
                  message: staticInfo.hostname,
                });
              }}
              shortcut={{ modifiers: ["cmd"], key: "c" }}
            />
            <Action
              title="Copy OS Info"
              icon={Icon.Clipboard}
              onAction={async () => {
                const text = `${staticInfo.os.name} ${staticInfo.os.version} (${staticInfo.os.kernel})`;
                await Clipboard.copy(text);
                await showToast({
                  style: Toast.Style.Success,
                  title: "Copied OS Info",
                  message: text,
                });
              }}
              shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
            />
            <Action.CopyToClipboard
              title="Copy All Info"
              content={markdown}
              shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

export default function SystemInfoCommand() {
  return (
    <QueryClientProvider client={queryClient}>
      <SystemInfoContent />
    </QueryClientProvider>
  );
}
