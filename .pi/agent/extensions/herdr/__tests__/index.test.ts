import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadHerdrExtension, supportsHerdrEnvironment } from "../index";

const herdrEnvironment = { HERDR_ENV: "1" };
const pi = {} as ExtensionAPI;

describe("Herdr extension entrypoint", () => {
  test("does not import the implementation outside a Herdr session", async () => {
    let imports = 0;

    const loaded = await loadHerdrExtension(pi, {}, async () => {
      imports += 1;
      return { default: () => {} };
    });

    expect(loaded).toBeFalse();
    expect(imports).toBe(0);
  });

  test("imports and registers the implementation in a Herdr session", async () => {
    let imports = 0;
    let registrations = 0;

    const loaded = await loadHerdrExtension(pi, herdrEnvironment, async () => {
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

  test("requires HERDR_ENV before importing", () => {
    expect(supportsHerdrEnvironment({})).toBeFalse();
    expect(supportsHerdrEnvironment({ HERDR_ENV: "0" })).toBeFalse();
    expect(supportsHerdrEnvironment(herdrEnvironment)).toBeTrue();
  });
});
