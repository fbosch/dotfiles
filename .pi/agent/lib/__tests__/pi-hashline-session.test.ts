import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  allocateAnchor,
  ownerOf,
  releaseRegistrySession,
  resetRegistryForTests,
  sessionKeyFor,
  withAnchorSession,
} from "../../npm/node_modules/pi-hashline-edit-pro/src/anchor-registry";
import { sessionClaimsDir } from "../../npm/node_modules/pi-hashline-edit-pro/src/paths";

describe("pi-hashline-edit-pro session registry", () => {
  test("keeps and persists early anchors when the session file appears", async () => {
    resetRegistryForTests();
    const directory = mkdtempSync(join(tmpdir(), "pi-hashline-session-test-"));
    const persistedSessionFile = join(directory, "session.jsonl");
    const sidecarKey = createHash("sha256").update(persistedSessionFile).digest("hex").slice(0, 24);
    const sidecar = join(sessionClaimsDir(), `${sidecarKey}.registry.jsonl`);
    let sessionFile: string | undefined;
    const context = {
      sessionManager: {
        getSessionId: () => "session-with-late-file",
        getSessionFile: () => sessionFile,
      },
    };

    try {
      let earlyAnchor = "";
      await withAnchorSession(context, () => {
        earlyAnchor = allocateAnchor("/tmp/early", "early-checksum");
        expect(ownerOf(earlyAnchor)?.path).toBe("/tmp/early");
      });

      writeFileSync(persistedSessionFile, "");
      sessionFile = persistedSessionFile;
      let laterAnchor = "";
      await Promise.all([
        withAnchorSession(context, () => {
          expect(ownerOf(earlyAnchor)?.path).toBe("/tmp/early");
        }),
        withAnchorSession(context, () => {
          expect(ownerOf(earlyAnchor)?.path).toBe("/tmp/early");
          laterAnchor = allocateAnchor("/tmp/later", "later-checksum");
        }),
      ]);

      const key = sessionKeyFor(context);
      if (key === undefined) throw new Error("Expected a session registry key");
      releaseRegistrySession(key);

      await withAnchorSession(context, () => {
        expect(ownerOf(earlyAnchor)?.path).toBe("/tmp/early");
        expect(ownerOf(laterAnchor)?.path).toBe("/tmp/later");
      });
    } finally {
      const key = sessionKeyFor(context);
      if (key !== undefined) releaseRegistrySession(key);
      rmSync(sidecar, { force: true });
      rmSync(directory, { recursive: true, force: true });
      resetRegistryForTests();
    }
  });
});
