export type StaticSystemInfo = {
  // Hardware (doesn't change during runtime)
  hostname: string;
  model?: string;
  cpu: {
    name: string;
    cores: number;
    threads: number;
    speed?: string;
  };
  
  // Operating System (static)
  os: {
    name: string;
    version: string;
    kernel: string;
    architecture: string;
  };
  
  // Graphics (doesn't change)
  gpu?: {
    name: string;
    vendor?: string;
  };
  
  // Display (doesn't change)
  displays?: Display[];
};

export type DynamicSystemInfo = {
  // Memory usage (changes frequently)
  memory: {
    total: number;
    used: number;
    available: number;
    usagePercent: number;
  };
  
  // Swap usage (changes frequently)
  swap: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  
  // Storage usage (changes frequently)
  storage: StorageDevice[];
  
  // Uptime (changes constantly)
  uptime: number;
};

export type SystemInfo = StaticSystemInfo & {
  memory: DynamicSystemInfo["memory"];
  swap: DynamicSystemInfo["swap"];
  storage: DynamicSystemInfo["storage"];
  os: StaticSystemInfo["os"] & {
    uptime: number;
  };
  
  // Network (optional, future)
  network?: {
    localIP?: string;
    publicIP?: string;
  };
  
  // Battery (optional, future)
  battery?: {
    percentage: number;
    status: string;
    isCharging: boolean;
  };
};


export type StorageCategory = {
  name: string;
  bytes: number;
  color: string;
};

export type StorageDevice = {
  name: string;
  mountPoint: string;
  total: number;
  used: number;
  available: number;
  usagePercent: number;
  filesystem?: string;
  categories?: StorageCategory[];
};

export type Display = {
  name: string;
  resolution: string;
  refreshRate?: number;
  scale?: number;
};

export type Preferences = {
  showDistroArt: boolean;
  refreshInterval: string;
};
