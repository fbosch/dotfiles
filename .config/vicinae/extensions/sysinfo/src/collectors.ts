import { readFile } from "node:fs/promises";
import { execAsync } from "./utils";

export async function getOSInfo() {
  try {
    // Parallelize all independent operations
    const [osRelease, kernel, arch, modelInfo] = await Promise.all([
      readFile("/etc/os-release", "utf-8"),
      execAsync("uname -r").then((r) => r.stdout.trim()),
      execAsync("uname -m").then((r) => r.stdout.trim()),
      // Try to get model info in parallel
      Promise.all([
        readFile("/sys/devices/virtual/dmi/id/product_name", "utf-8").then((s) => s.trim()).catch(() => ""),
        readFile("/sys/devices/virtual/dmi/id/product_version", "utf-8").then((s) => s.trim()).catch(() => ""),
      ]).catch(() => ["", ""]),
    ]);

    const prettyName = osRelease.match(/PRETTY_NAME="([^"]+)"/)?.[1] || "Linux";
    const versionId = osRelease.match(/VERSION_ID="([^"]+)"/)?.[1] || "";
    const versionCodename = osRelease
      .match(/VERSION_CODENAME=([^\n]+)/)?.[1]
      ?.trim();

    console.log("OS Info:", { prettyName, versionId, versionCodename });

    // Process model info
    const [productName, productVersion] = modelInfo;
    const model =
      productName && productVersion && productVersion !== "None"
        ? `${productName} ${productVersion}`
        : productName || undefined;

    return {
      osName: prettyName,
      osVersion: versionId,
      osCodename: versionCodename,
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

export async function getCPUInfo() {
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

export async function getGPUInfo() {
  try {
    // Try lspci first
    const { stdout } = await execAsync("lspci | grep -i 'vga\\|3d\\|display'");
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

export async function getMemoryAndSwapInfo() {
  try {
    const meminfo = await readFile("/proc/meminfo", "utf-8");
    
    // Parse memory info
    const memTotal =
      Number.parseInt(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] || "0", 10) * 1024;
    const memAvailable =
      Number.parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] || "0", 10) * 1024;
    const memUsed = memTotal - memAvailable;
    const memUsagePercent = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;
    
    // Parse swap info
    const swapTotal =
      Number.parseInt(meminfo.match(/SwapTotal:\s+(\d+)/)?.[1] || "0", 10) * 1024;
    const swapFree =
      Number.parseInt(meminfo.match(/SwapFree:\s+(\d+)/)?.[1] || "0", 10) * 1024;
    const swapUsed = swapTotal - swapFree;
    const swapUsagePercent = swapTotal > 0 ? (swapUsed / swapTotal) * 100 : 0;

    return {
      memory: {
        total: memTotal,
        used: memUsed,
        available: memAvailable,
        usagePercent: memUsagePercent,
      },
      swap: {
        total: swapTotal,
        used: swapUsed,
        free: swapFree,
        usagePercent: swapUsagePercent,
      },
    };
  } catch {
    return {
      memory: {
        total: 0,
        used: 0,
        available: 0,
        usagePercent: 0,
      },
      swap: {
        total: 0,
        used: 0,
        free: 0,
        usagePercent: 0,
      },
    };
  }
}

export async function getStorageInfo() {
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

export async function getUptime() {
  try {
    const uptimeStr = await readFile("/proc/uptime", "utf-8");
    return Number.parseFloat(uptimeStr.split(" ")[0]);
  } catch {
    return 0;
  }
}

export async function getPackageCount(): Promise<{
  nix?: number;
  flatpak?: number;
  dpkg?: number;
  rpm?: number;
  pacman?: number;
} | undefined> {
  const packages: {
    nix?: number;
    flatpak?: number;
    dpkg?: number;
    rpm?: number;
    pacman?: number;
  } = {};

  // Run all package manager checks in parallel
  const [nixResult, dpkgResult, rpmResult, pacmanResult, flatpakResult] = await Promise.all([
    // NixOS (system + user)
    Promise.all([
      execAsync("nix-store -q --requisites /run/current-system 2>/dev/null | wc -l").catch(() => ({ stdout: "0" })),
      execAsync("nix-store -q --requisites ~/.nix-profile 2>/dev/null | wc -l").catch(() => ({ stdout: "0" })),
    ]).then(([nixSystem, nixUser]) => {
      const systemCount = Number.parseInt(nixSystem.stdout.trim(), 10);
      const userCount = Number.parseInt(nixUser.stdout.trim(), 10);
      return systemCount + userCount;
    }).catch(() => 0),
    
    // dpkg (Debian/Ubuntu)
    execAsync("dpkg -l | grep '^ii' | wc -l")
      .then(({ stdout }) => Number.parseInt(stdout.trim(), 10))
      .catch(() => 0),
    
    // rpm (RedHat/Fedora/CentOS)
    execAsync("rpm -qa | wc -l")
      .then(({ stdout }) => Number.parseInt(stdout.trim(), 10))
      .catch(() => 0),
    
    // pacman (Arch)
    execAsync("pacman -Q | wc -l")
      .then(({ stdout }) => Number.parseInt(stdout.trim(), 10))
      .catch(() => 0),
    
    // Flatpak
    execAsync("flatpak list --app 2>/dev/null | wc -l")
      .then(({ stdout }) => Number.parseInt(stdout.trim(), 10))
      .catch(() => 0),
  ]);

  if (nixResult > 0) packages.nix = nixResult;
  if (dpkgResult > 0) packages.dpkg = dpkgResult;
  if (rpmResult > 0) packages.rpm = rpmResult;
  if (pacmanResult > 0) packages.pacman = pacmanResult;
  if (flatpakResult > 0) packages.flatpak = flatpakResult;

  return Object.keys(packages).length > 0 ? packages : undefined;
}

export async function getDisplayInfo() {
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
