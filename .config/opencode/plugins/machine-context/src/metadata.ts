import os from "node:os"

type StaticMetadata = {
  hostname: string
  platform: string
  release: string
  arch: string
  cpuModel: string
  cpuCores: number
  memoryTotal: number
  user: string
}

type DynamicMetadata = {
  memoryFree: number
  loadAvg: [number, number, number]
}

const STRING_MAX_LEN = 256

const sanitize = (value: string, maxLen = STRING_MAX_LEN) =>
  value.replace(/[\r\n]/g, " ").slice(0, maxLen)

const safeString = (fn: () => string, fallback = "unknown") => {
  try {
    const value = fn()
    return sanitize(value || fallback)
  } catch {
    return fallback
  }
}

const safeNumber = (fn: () => number, fallback = 0) => {
  try {
    const value = fn()
    return Number.isFinite(value) ? value : fallback
  } catch {
    return fallback
  }
}

const safeCpuInfo = () => {
  try {
    const cpus = os.cpus()
    if (!cpus.length) {
      return { cpuModel: "unknown", cpuCores: 0 }
    }
    return {
      cpuModel: sanitize(cpus[0]?.model || "unknown"),
      cpuCores: cpus.length,
    }
  } catch {
    return { cpuModel: "unknown", cpuCores: 0 }
  }
}

export const collectStaticMetadata = (): StaticMetadata => {
  const { cpuModel, cpuCores } = safeCpuInfo()
  return {
    hostname: safeString(() => os.hostname()),
    platform: safeString(() => os.platform()),
    release: safeString(() => os.release()),
    arch: safeString(() => os.arch()),
    cpuModel,
    cpuCores,
    memoryTotal: safeNumber(() => os.totalmem()),
    user: safeString(() => os.userInfo().username),
  }
}

export const collectDynamicMetadata = (): DynamicMetadata => {
  const load = (() => {
    try {
      const [a = 0, b = 0, c = 0] = os.loadavg()
      return [a, b, c] as [number, number, number]
    } catch {
      return [0, 0, 0] as [number, number, number]
    }
  })()

  return {
    memoryFree: safeNumber(() => os.freemem()),
    loadAvg: load,
  }
}

const toGiB = (bytes: number) => Math.max(0, Math.round(bytes / (1024 ** 3)))

const compactHost = (hostname: string) => hostname.replace(/\.local$/, "")

const formatLoad = ([a, b, c]: [number, number, number]) =>
  `${a.toFixed(1)}/${b.toFixed(1)}/${c.toFixed(1)}`

export const formatMachineContext = (
  metadataStatic: StaticMetadata,
  metadataDynamic: DynamicMetadata,
) => {
  const staticFields = [
    `os=${metadataStatic.platform}/${metadataStatic.release}/${metadataStatic.arch}`,
    `cpu=${metadataStatic.cpuCores}c`,
    `mem=${toGiB(metadataStatic.memoryTotal)}G`,
    `host=${compactHost(metadataStatic.hostname)}`,
    `user=${metadataStatic.user}`,
  ]

  const freeRatio = metadataStatic.memoryTotal > 0
    ? metadataDynamic.memoryFree / metadataStatic.memoryTotal
    : 1
  const highLoad = metadataDynamic.loadAvg[0] > metadataStatic.cpuCores * 1.5
  const lowMemory = freeRatio < 0.2

  if (highLoad || lowMemory) {
    staticFields.push(`load=${formatLoad(metadataDynamic.loadAvg)}`)
    staticFields.push(`free=${toGiB(metadataDynamic.memoryFree)}G`)
  }

  return `<mc>${staticFields.join(" ")}</mc>`
}

export const marker = "<mc>"
