import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PackagePatch } from "../../../lib/patch-catalog";
import { updateAllAvailablePackages } from "../update-all";
import type { UpdateDetail } from "../updates";

const updates: readonly UpdateDetail[] = [
  { name: "user-package", current: "1.0.0", latest: "2.0.0", scope: "user" },
  { name: "project-package", current: "1.0.0", latest: "1.1.0", scope: "project" },
];

function context(confirm: (title: string, message: string) => Promise<boolean>): ExtensionContext {
  return {
    cwd: "/tmp/project",
    isProjectTrusted: () => true,
    ui: { confirm },
  } as unknown as ExtensionContext;
}

function patch(name: string, version: string): PackagePatch {
  return { name, version, patchFilenames: [`${name}+${version}.patch`] };
}

describe("update all available packages", () => {
  test("installs every displayed target in order and continues after an individual failure", async () => {
    const installed: UpdateDetail[] = [];
    const result = await updateAllAvailablePackages(
      context(async () => true),
      updates,
      {
        readPatches: () => [],
        installPackage: async (_context, update) => {
          installed.push(update);
          if (update.name === "user-package") throw new Error("install failed");
        },
      },
    );

    expect(installed).toEqual([...updates]);
    expect(result).toEqual({ updated: 1, failed: ["user-package"], cancelled: false });
  });

  test("asks before leaving a current-version local patch behind", async () => {
    let confirmation: { title: string; message: string } | undefined;
    let installs = 0;
    const result = await updateAllAvailablePackages(
      context(async (title, message) => {
        confirmation = { title, message };
        return false;
      }),
      [{ name: "patched", current: "1.0.0", latest: "1.1.0", scope: "user" }],
      {
        readPatches: () => [patch("patched", "1.0.0")],
        installPackage: async () => {
          installs += 1;
        },
      },
    );

    expect(confirmation).toEqual({
      title: "Update packages with local patches?",
      message:
        "Updating patched 1.0.0 → 1.1.0 will install versions that do not match their local patches. Continue?",
    });
    expect(installs).toBe(0);
    expect(result).toEqual({ updated: 0, failed: [], cancelled: true });
  });

  test("proceeds with the selected updates after the patch warning is accepted", async () => {
    const installed: UpdateDetail[] = [];
    const result = await updateAllAvailablePackages(
      context(async () => true),
      [{ name: "patched", current: "1.0.0", latest: "1.1.0", scope: "user" }],
      {
        readPatches: () => [patch("patched", "1.0.0")],
        installPackage: async (_context, update) => {
          installed.push(update);
        },
      },
    );

    expect(installed).toHaveLength(1);
    expect(result).toEqual({ updated: 1, failed: [], cancelled: false });
  });
});
