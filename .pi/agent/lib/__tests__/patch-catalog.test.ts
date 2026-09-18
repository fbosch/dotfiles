import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverPackagePatches } from "../patch-catalog";

const patch = `diff --git a/node_modules/example/index.js b/node_modules/example/index.js
index 3367afd..5ea2ed4 100644
--- a/node_modules/example/index.js
+++ b/node_modules/example/index.js
@@ -1 +1 @@
-original
+patched
`;

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pi-patch-catalog-test-"));
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

function addPatch(filename: string, contents = patch): void {
  writeFileSync(join(directory, filename), contents);
}

describe("package patch discovery", () => {
  test("derives scoped and unscoped packages from the patch directory", () => {
    addPatch("pi-worktrunk+0.8.0.patch");
    addPatch("@ff-labs+pi-fff+0.10.6.patch");
    writeFileSync(join(directory, "README.md"), "ignored\n");

    expect(discoverPackagePatches(directory)).toEqual([
      {
        name: "@ff-labs/pi-fff",
        version: "0.10.6",
        patchFilenames: ["@ff-labs+pi-fff+0.10.6.patch"],
      },
      {
        name: "pi-worktrunk",
        version: "0.8.0",
        patchFilenames: ["pi-worktrunk+0.8.0.patch"],
      },
    ]);
  });

  test("groups patch-package sequence files for one package", () => {
    addPatch("pi-worktrunk+0.8.0.patch");
    addPatch("pi-worktrunk+0.8.0+001+follow-up.patch");

    expect(discoverPackagePatches(directory)).toEqual([
      {
        name: "pi-worktrunk",
        version: "0.8.0",
        patchFilenames: ["pi-worktrunk+0.8.0+001+follow-up.patch", "pi-worktrunk+0.8.0.patch"],
      },
    ]);
  });

  test("allows an empty patch directory", () => {
    expect(discoverPackagePatches(directory)).toEqual([]);
  });

  test.each([
    "missing-version.patch",
    "@scope+1.2.3.patch",
    "@scope+package+1.2.3+label.patch",
    "parent+1.2.3++child+2.0.0.patch",
  ])("rejects malformed or unsupported filename %s", (filename) => {
    addPatch(filename);

    expect(() => discoverPackagePatches(directory)).toThrow("Invalid patch filename");
  });

  test("rejects multiple reviewed versions of one package", () => {
    addPatch("example+1.0.0.patch");
    addPatch("example+2.0.0.patch");

    expect(() => discoverPackagePatches(directory)).toThrow(
      "Patch directory contains multiple versions of example: 1.0.0 and 2.0.0",
    );
  });

  test.each(["", " \n", "not a patch", "diff --git a/example b/example\n"])(
    "rejects patches without textual changes: %j",
    (contents) => {
      addPatch("example+1.0.0.patch", contents);

      expect(() => discoverPackagePatches(directory)).toThrow("contains no textual changes");
    },
  );
});
