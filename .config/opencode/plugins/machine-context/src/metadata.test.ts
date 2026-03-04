import { describe, expect, test } from "bun:test"
import { collectDynamicMetadata, collectStaticMetadata, formatMachineContext, marker } from "./metadata"

describe("machine-context metadata", () => {
  test("formats with marker wrapper", () => {
    const text = formatMachineContext(
      {
        hostname: "host",
        platform: "darwin",
        release: "24.3.0",
        arch: "arm64",
        cpuModel: "Apple",
        cpuCores: 12,
        memoryTotal: 100,
        user: "fbb",
      },
      {
        memoryFree: 50,
        loadAvg: [1, 2, 3],
      },
    )

    expect(text.startsWith(marker)).toBeTrue()
    expect(text.endsWith("</mc>")).toBeTrue()
  })

  test("keeps payload compact in normal conditions", () => {
    const text = formatMachineContext(
      {
        hostname: "Frederiks-Macbook-Pro.local",
        platform: "darwin",
        release: "25.3.0",
        arch: "arm64",
        cpuModel: "Apple M4 Pro",
        cpuCores: 14,
        memoryTotal: 25769803776,
        user: "fbb",
      },
      {
        memoryFree: 17179869184,
        loadAvg: [2, 2, 2],
      },
    )

    expect(text).toContain("<mc>")
    expect(text).toContain("os=darwin/25.3.0/arm64")
    expect(text).not.toContain("load=")
    expect(text).not.toContain("free=")
  })

  test("collectors return fallback-safe shapes", () => {
    const staticData = collectStaticMetadata()
    const dynamicData = collectDynamicMetadata()

    expect(typeof staticData.hostname).toBe("string")
    expect(typeof staticData.cpuCores).toBe("number")
    expect(typeof dynamicData.memoryFree).toBe("number")
    expect(dynamicData.loadAvg.length).toBe(3)
  })
})
