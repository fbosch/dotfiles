import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ok } from "neverthrow";
import {
  createOpenCodeAnswerBackend,
  runOpenCodePreflight,
  type AnswerBackendRequest,
  type OpenCodeBackendDependencies,
  type OpenCodeClient,
} from "../index.js";

describe("OpenCode answer backend", () => {
  test("reports ready from a compatible external server without creating a session", async () => {
    const fake = createFake();

    assert.deepEqual(await runOpenCodePreflight(fake.dependencies), { ready: true });
    assert.equal(fake.state.ownedStarts, 0);
    assert.equal(fake.state.externalCreate, 0);
    assert.equal(fake.state.externalPrompt, 0);
    assert.equal(fake.state.externalClose, 0);
  });

  test("accepts compatible newer CLI and server versions", async () => {
    const fake = createFake({ cliVersion: "1.18.21", serverVersion: "1.19.0" });

    assert.deepEqual(await runOpenCodePreflight(fake.dependencies), { ready: true });
  });

  test("uses and closes an owned fallback without creating a session", async () => {
    const fake = createFake({ externalHealthy: false });

    assert.deepEqual(await runOpenCodePreflight(fake.dependencies), { ready: true });
    assert.equal(fake.state.ownedStarts, 1);
    assert.equal(fake.state.ownedClose, 1);
    assert.equal(fake.state.externalCreate, 0);
    assert.equal(fake.state.externalPrompt, 0);
    assert.equal(fake.state.ownedCreate, 0);
    assert.equal(fake.state.ownedPrompt, 0);
  });

  test("returns concise readiness failures for invalid agent policy, model, and version", async () => {
    const missingAgent = createFake({ agent: false });
    const permissiveAgent = createFake({ wildcardDenied: false });
    const unknownTool = createFake({ toolIDs: [""] });
    const unavailableModel = createFake({ imageCapable: false });
    const incompatibleCli = createFake({ cliVersion: "1.18.20" });
    const incompatibleServer = createFake({ serverVersion: "2.0.0" });
    const prereleaseServer = createFake({ serverVersion: "1.19.0-beta.1" });
    const malformedServer = createFake({ serverVersion: "1.019.0" });

    assert.deepEqual(await runOpenCodePreflight(missingAgent.dependencies), { ready: false, code: "backend_policy_invalid" });
    assert.deepEqual(await runOpenCodePreflight(permissiveAgent.dependencies), { ready: false, code: "backend_policy_invalid" });
    assert.deepEqual(await runOpenCodePreflight(unknownTool.dependencies), { ready: false, code: "backend_policy_invalid" });
    assert.deepEqual(await runOpenCodePreflight(unavailableModel.dependencies), { ready: false, code: "backend_policy_invalid" });
    assert.deepEqual(await runOpenCodePreflight(incompatibleCli.dependencies), { ready: false, code: "incompatible_version" });
    assert.deepEqual(await runOpenCodePreflight(incompatibleServer.dependencies), { ready: false, code: "incompatible_version" });
    assert.deepEqual(await runOpenCodePreflight(prereleaseServer.dependencies), { ready: false, code: "incompatible_version" });
    assert.deepEqual(await runOpenCodePreflight(malformedServer.dependencies), { ready: false, code: "incompatible_version" });
    assert.equal(incompatibleCli.state.ownedStarts, 0);
  });

  test("returns cancellation and closes an owned server during readiness checks", async () => {
    const fake = createFake({ externalHealthy: false, ownedHealthHangs: true });
    const controller = new AbortController();
    const pending = runOpenCodePreflight(fake.dependencies, controller.signal);
    await waitFor(() => fake.state.ownedStarts === 1);
    controller.abort();

    assert.deepEqual(await pending, { ready: false, code: "cancelled" });
    assert.equal(fake.state.ownedClose, 1);
    assert.equal(fake.state.ownedCreate, 0);
    assert.equal(fake.state.ownedPrompt, 0);
  });

  test("reuses a compatible external server without closing it", async () => {
    const fake = createFake();
    const result = await fake.backend.execute(request());

    assert.deepEqual(result, { ok: true, parts: [{ type: "text", text: "answer" }] });
    assert.equal(fake.state.ownedStarts, 0);
    assert.equal(fake.state.externalClose, 0);
    assert.equal(fake.state.externalDelete, 1);
    assert.deepEqual(fake.state.tools, { bash: false, read: false });
  });

  test("starts and closes an owned server when external preflight is unsuitable", async () => {
    const fake = createFake({ externalHealthy: false });
    const result = await fake.backend.execute(request());

    assert.equal(result.ok, true);
    assert.equal(fake.state.ownedStarts, 1);
    assert.equal(fake.state.ownedClose, 1);
    assert.equal(fake.state.externalPrompt, 0);
  });

  test("does not load attachment bytes when agent or tool policy verification fails", async () => {
    const missingAgent = createFake({ agent: false });
    const permissiveAgent = createFake({ wildcardDenied: false });
    const invalidTools = createFake({ toolIDs: [""] });
    let loaded = 0;
    const withLoader = (): AnswerBackendRequest => ({ ...request(), loadAttachments: async () => {
      loaded += 1;
      return ok([]);
    } });

    assert.deepEqual(await missingAgent.backend.execute(withLoader()), { ok: false, code: "backend_policy_invalid" });
    assert.deepEqual(await permissiveAgent.backend.execute(withLoader()), { ok: false, code: "backend_policy_invalid" });
    assert.deepEqual(await invalidTools.backend.execute(withLoader()), { ok: false, code: "backend_policy_invalid" });
    assert.equal(loaded, 0);
  });

  test("submits final assistant parts and deletes the ephemeral session", async () => {
    const fake = createFake();
    const result = await fake.backend.execute(request());

    assert.deepEqual(result, { ok: true, parts: [{ type: "text", text: "answer" }] });
    assert.equal(fake.state.externalCreate, 1);
    assert.equal(fake.state.externalDelete, 1);
    assert.equal(fake.state.externalPrompt, 1);
  });

  test("returns provider failure and still deletes its session", async () => {
    const fake = createFake({ promptFailure: true });
    const result = await fake.backend.execute(request());

    assert.deepEqual(result, { ok: false, code: "provider_failed" });
    assert.equal(fake.state.externalAbort, 1);
    assert.equal(fake.state.externalDelete, 1);
  });

  test("aborts then deletes on timeout and caller cancellation", async () => {
    const timeout = createFake({ promptHangs: true });
    const timeoutResult = await timeout.backend.execute({ ...request(), timeoutSeconds: 0.01 });
    assert.deepEqual(timeoutResult, { ok: false, code: "timeout" });
    assert.equal(timeout.state.externalAbort, 1);
    assert.equal(timeout.state.externalDelete, 1);

    const cancelled = createFake({ promptHangs: true });
    const controller = new AbortController();
    const pending = cancelled.backend.execute({ ...request(), signal: controller.signal });
    await waitFor(() => cancelled.state.externalPrompt === 1);
    controller.abort();
    assert.deepEqual(await pending, { ok: false, code: "cancelled" });
    assert.equal(cancelled.state.externalAbort, 1);
    assert.equal(cancelled.state.externalDelete, 1);
  });

  test("reports cleanup failure and closes an owned server exactly once", async () => {
    const fake = createFake({ externalHealthy: false, deleteFails: true });
    const result = await fake.backend.execute(request());

    assert.deepEqual(result, { ok: false, code: "cleanup_failed" });
    assert.equal(fake.state.ownedClose, 1);
  });

  test("treats SDK error wrappers and false deletion results as cleanup failures", async () => {
    const wrapped = createFake({ deleteError: true });
    const falseResult = createFake({ deleteFalse: true });

    assert.deepEqual(await wrapped.backend.execute(request()), { ok: false, code: "cleanup_failed" });
    assert.deepEqual(await falseResult.backend.execute(request()), { ok: false, code: "cleanup_failed" });
  });

  test("rejects an incomplete final assistant envelope", async () => {
    const fake = createFake({ incompleteAssistant: true });
    assert.deepEqual(await fake.backend.execute(request()), { ok: false, code: "provider_failed" });
    assert.equal(fake.state.externalDelete, 1);
  });

  test("uses the resolved agent model and preserves model IDs containing slashes", async () => {
    const fake = createFake({ agentModel: true, modelID: "family/test" });
    assert.equal((await fake.backend.execute(request())).ok, true);
  });

  test("returns cancelled rather than timeout while owned preflight is active", async () => {
    const fake = createFake({ externalHealthy: false, ownedHealthHangs: true });
    const controller = new AbortController();
    const pending = fake.backend.execute({ ...request(), signal: controller.signal });
    await waitFor(() => fake.state.ownedStarts === 1);
    controller.abort();
    assert.deepEqual(await pending, { ok: false, code: "cancelled" });
    assert.equal(fake.state.ownedClose, 1);
  });

  test("rejects mismatched CLI or server versions before loading attachments", async () => {
    const cli = createFake({ cliVersion: "1.18.17" });
    const server = createFake({ serverVersion: "1.18.17" });
    let loaded = 0;
    const input = { ...request(), loadAttachments: async () => { loaded += 1; return ok([]); } };

    assert.deepEqual(await cli.backend.execute(input), { ok: false, code: "incompatible_version" });
    assert.deepEqual(await server.backend.execute(input), { ok: false, code: "incompatible_version" });
    assert.equal(loaded, 0);
  });

  test("accepts only backend-neutral caller input", async () => {
    const fake = createFake();
    const input = request();
    assert.equal("agent" in input, false);
    assert.equal("model" in input, false);
    assert.equal("endpoint" in input, false);
    await fake.backend.execute(input);
    assert.equal(fake.state.externalPrompt, 1);
  });
});

function request(): AnswerBackendRequest {
  return {
    prompt: "What is visible?",
    timeoutSeconds: 5,
    loadAttachments: async () => ok([]),
  };
}

function createFake(options: {
  agent?: boolean;
  cliVersion?: string;
  deleteFails?: boolean;
  deleteError?: boolean;
  deleteFalse?: boolean;
  externalHealthy?: boolean;
  incompleteAssistant?: boolean;
  imageCapable?: boolean;
  agentModel?: boolean;
  modelID?: string;
  ownedHealthHangs?: boolean;
  promptFailure?: boolean;
  promptHangs?: boolean;
  serverVersion?: string;
  toolIDs?: string[];
  wildcardDenied?: boolean;
} = {}) {
  const state = {
    externalAbort: 0,
    externalClose: 0,
    externalCreate: 0,
    externalDelete: 0,
    externalPrompt: 0,
    ownedClose: 0,
    ownedCreate: 0,
    ownedPrompt: 0,
    ownedStarts: 0,
    tools: {} as Record<string, false>,
  };
  const client = (kind: "external" | "owned"): OpenCodeClient => ({
    global: { health: async () => {
      if (kind === "owned" && options.ownedHealthHangs) return await new Promise<never>(() => undefined);
      return { data: { healthy: options.externalHealthy === false && kind === "external" ? false : true, version: options.serverVersion ?? "1.18.21" } };
    } },
    app: { agents: async () => ({ data: options.agent === false ? [] : [{ name: "desktop-pointer", model: options.agentModel ? { providerID: "openai", modelID: options.modelID ?? "test" } : undefined, permission: options.wildcardDenied === false ? [] : [{ permission: "*", pattern: "*", action: "deny" }] }] }) },
    config: { get: async () => ({ data: { model: `openai/${options.modelID ?? "test"}` } }) },
    provider: { list: async () => ({ data: { connected: ["openai"], all: [{ id: "openai", models: { [options.modelID ?? "test"]: { status: "active", capabilities: { input: { image: options.imageCapable !== false } } } } }] } }) },
    tool: { ids: async () => ({ data: options.toolIDs ?? ["bash", "read"] }) },
    session: {
      create: async () => {
        if (kind === "external") state.externalCreate += 1;
        else state.ownedCreate += 1;
        return { data: { id: `${kind}-session` } };
      },
      prompt: async (input) => {
        if (kind === "external") state.externalPrompt += 1;
        else state.ownedPrompt += 1;
        state.tools = input.tools;
        if (options.promptHangs) return await new Promise<never>(() => undefined);
        if (options.promptFailure) throw new Error("provider failed");
        return { data: { info: options.incompleteAssistant ? { role: "assistant", time: {} } : { role: "assistant", time: { completed: 1 } }, parts: [{ type: "text", text: "answer" }] } };
      },
      abort: async () => { state.externalAbort += kind === "external" ? 1 : 0; return {}; },
      delete: async () => {
        state.externalDelete += kind === "external" ? 1 : 0;
        if (options.deleteFails) throw new Error("delete failed");
        if (options.deleteError) return { error: { message: "delete failed" } };
        if (options.deleteFalse) return { data: false };
        return {};
      },
    },
  });
  const external = client("external");
  const owned = client("owned");
  const dependencies: OpenCodeBackendDependencies = {
    createClient: () => external,
    createOwned: async () => {
      state.ownedStarts += 1;
      return { client: owned, close: () => { state.ownedClose += 1; } };
    },
    getCliVersion: async () => options.cliVersion ?? "1.18.21",
  };
  return { backend: createOpenCodeAnswerBackend(dependencies), dependencies, state };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  while (predicate() === false) await new Promise((resolve) => setTimeout(resolve, 1));
}
