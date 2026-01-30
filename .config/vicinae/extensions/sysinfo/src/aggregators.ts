import {
  getCPUInfo,
  getDisplayInfo,
  getGPUInfo,
  getMemoryAndSwapInfo,
  getOSInfo,
  getPackageCount,
  getStorageInfo,
  getUptime,
} from "./collectors";
import type { DynamicSystemInfo, StaticSystemInfo } from "./types";
import { execAsync } from "./utils";

// Static system info - things that don't change during runtime
export async function getStaticSystemInfo(): Promise<StaticSystemInfo> {
  const [hostname, osInfo, cpuInfo, gpuInfo, displayInfo, packageCount] =
    await Promise.all([
      execAsync("hostname").then((r) => r.stdout.trim()),
      getOSInfo(),
      getCPUInfo(),
      getGPUInfo(),
      getDisplayInfo(),
      getPackageCount(),
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
      codename: osInfo.osCodename,
      kernel: osInfo.kernel,
      architecture: osInfo.architecture,
      packages: packageCount,
    },
  };

	return info;
}

// Dynamic system info - things that change frequently
export async function getDynamicSystemInfo(): Promise<DynamicSystemInfo> {
  const [memAndSwap, storageInfo, uptimeInfo] = await Promise.all([
    getMemoryAndSwapInfo(),
    getStorageInfo(),
    getUptime(),
  ]);

  return {
    memory: memAndSwap.memory,
    swap: memAndSwap.swap,
    storage: storageInfo,
    uptime: uptimeInfo,
  };
}
