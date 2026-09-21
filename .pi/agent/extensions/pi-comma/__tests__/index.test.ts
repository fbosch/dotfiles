import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadPiCommaExtension, supportsPiCommaPlatform } from "../index";

const pi = {} as ExtensionAPI;

describe("pi-comma extension entrypoint", () => {
  test("does not import the implementation on unsupported platforms", async () => {
    let imports = 0;

    const loaded = await loadPiCommaExtension(pi, "win32", async () => {
      imports += 1;
      return { default: () => {} };
    });

    expect(loaded).toBeFalse();
    expect(imports).toBe(0);
  });

  test("imports and registers the implementation on a supported platform", async () => {
    let imports = 0;
    let registrations = 0;

    const loaded = await loadPiCommaExtension(pi, "darwin", async () => {
      imports += 1;
      return {
        default: (receivedPi) => {
          expect(receivedPi).toBe(pi);
          registrations += 1;
        },
      };
    });

    expect(loaded).toBeTrue();
    expect(imports).toBe(1);
    expect(registrations).toBe(1);
  });

  test("supports only Unix platforms", () => {
    expect(supportsPiCommaPlatform("linux")).toBeTrue();
    expect(supportsPiCommaPlatform("darwin")).toBeTrue();
    expect(supportsPiCommaPlatform("win32")).toBeFalse();
  });
});
