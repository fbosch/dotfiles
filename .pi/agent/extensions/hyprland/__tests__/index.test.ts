import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadHyprlandExtension, supportsHyprlandEnvironment } from "../index";

const hyprlandEnvironment = {
  HYPRLAND_INSTANCE_SIGNATURE: "fixture",
  XDG_RUNTIME_DIR: "/run/user/1000",
  WAYLAND_DISPLAY: "wayland-1",
};

const pi = {} as ExtensionAPI;

describe("Hyprland extension entrypoint", () => {
  test("does not import the implementation outside a Hyprland session", async () => {
    let imports = 0;

    const loaded = await loadHyprlandExtension(pi, {}, async () => {
      imports += 1;
      return { default: () => {} };
    });

    expect(loaded).toBeFalse();
    expect(imports).toBe(0);
  });

  test("imports and registers the implementation in a Hyprland session", async () => {
    let imports = 0;
    let registrations = 0;

    const loaded = await loadHyprlandExtension(pi, hyprlandEnvironment, async () => {
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

  test("requires the complete Hyprland environment before importing", () => {
    expect(supportsHyprlandEnvironment({})).toBeFalse();
    expect(
      supportsHyprlandEnvironment({
        HYPRLAND_INSTANCE_SIGNATURE: "fixture",
        XDG_RUNTIME_DIR: "/run/user/1000",
      }),
    ).toBeFalse();
    expect(supportsHyprlandEnvironment(hyprlandEnvironment)).toBeTrue();
  });
});
