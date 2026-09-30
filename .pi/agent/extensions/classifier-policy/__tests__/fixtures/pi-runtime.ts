import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { requestClassifier } from "../../../../lib/classifier";
import classifierPolicyExtension from "../../index";

export default function (pi: ExtensionAPI): void {
  classifierPolicyExtension(pi);
  pi.registerCommand("classifier-policy-probe", {
    handler: async (_args, ctx) => {
      await ctx.reload();
    },
  });
  pi.on("session_start", async (_event, ctx) => {
    const input = {
      state: {},
      questions: {
        gate: {
          type: "bool" as const,
          instructions: "Check",
          criteria: { true: "Yes", false: "No" },
        },
      },
    };
    const model = ctx.modelRegistry.findOfType("classifier", "openrouter", "typesafe/jev-1.13");
    assert.ok(model);
    let fetches = 0;
    const fetch = Object.assign(
      async () => {
        fetches++;
        throw new Error("Unexpected classifier request");
      },
      { preconnect: globalThis.fetch.preconnect },
    );
    const native = await ctx.modelRegistry.classify(model, input, { fetch });
    assert.equal(native.stopReason, "error");
    assert.equal(native.errorMessage, "Classifier disabled by settings");
    assert.deepEqual(await requestClassifier(ctx.modelRegistry, input, { fetch }), {
      ok: false,
      stage: "config",
      reason: "disabled",
    });
    assert.equal(fetches, 0);
    console.log("CLASSIFIER_POLICY_RUNTIME_OK");
  });
}
