import { describe, expect, test } from "bun:test";
import {
  allocateAnchor,
  ownerOf,
  resetRegistryForTests,
  withAnchorSession,
} from "../../npm/node_modules/pi-hashline-edit-pro/src/anchor-registry";

describe("pi-hashline-edit-pro session registry", () => {
  test("keeps early anchors when the session file appears", async () => {
    resetRegistryForTests();
    let sessionFile: string | undefined;
    const context = {
      sessionManager: {
        getSessionId: () => "session-with-late-file",
        getSessionFile: () => sessionFile,
      },
    };

    let anchor = "";
    await withAnchorSession(context, () => {
      anchor = allocateAnchor("/tmp/example", "checksum");
      expect(ownerOf(anchor)?.path).toBe("/tmp/example");
    });

    sessionFile = "/tmp/session.jsonl";
    await withAnchorSession(context, () => {
      expect(ownerOf(anchor)?.path).toBe("/tmp/example");
    });
  });
});
