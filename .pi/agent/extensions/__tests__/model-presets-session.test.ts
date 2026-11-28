import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { type AssistantMessage, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type * as Pi from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import authProfiles from "../auth-profiles";
import { recordBridgeQuota } from "../auth-profiles/bridge-quota";
import {
  activateRoutingAccount,
  requestRoutingAccounts,
} from "../auth-profiles/routing-eligibility";
import {
  ANTHROPIC_USAGE_OBSERVATION,
  AUTH_USAGE_OBSERVATION,
  type ProfileUsageStatus,
} from "../auth-profiles/usage-status-service";
import modelPresets from "../model-presets";
import { createChildSession } from "../subagents/child-session";

const cleanup: Array<() => void | Promise<void>> = [];
const originalDir = process.env.PI_CODING_AGENT_DIR;
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
  if (originalDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalDir;
});

async function fixture(
  profile = "kk",
  quota = 80,
  stale = false,
  nativeQuota = 65,
  authProfile?: string,
) {
  const root = await mkdtemp(join(tmpdir(), "pi-preset-quota-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  process.env.PI_CODING_AGENT_DIR = root;
  await mkdir(join(root, "auth-profiles"));
  const oauth = (access: string) => ({
    type: "oauth",
    access,
    accountId: access,
    refresh: "fixture-refresh",
    expires: Date.now() + 86400000,
  });
  await writeFile(
    join(root, "auth-profiles", "kk.json"),
    JSON.stringify({ "openai-codex": oauth("kk-fixture-token") }),
  );
  await writeFile(
    join(root, "auth-profiles", "fbb.json"),
    JSON.stringify({
      "openai-codex": oauth("fbb-fixture-token"),
      anthropic: oauth("native-fixture-token"),
    }),
  );
  await writeFile(
    join(root, "auth-profiles.json"),
    JSON.stringify({
      defaultProfile: "fbb",
      repositoryPreferences: { [basename(root)]: [profile] },
    }),
  );
  let clockOffset = 0;
  let forceRefreshes = 0;
  let forcedQuota = quota;
  const now = () => Date.now() + clockOffset;
  const accounts = (forceRefresh: boolean) =>
    ["kk", "fbb"].map((label) => {
      const observedAt = now() - (stale ? 600000 : 0);
      const remaining = forceRefresh ? forcedQuota : quota;
      const result: ProfileUsageStatus = {
        profileLabel: label,
        active: label === profile,
        urgency: "unknown",
        usage: [{ remaining }],
      };
      Object.defineProperty(result, AUTH_USAGE_OBSERVATION, {
        value: { windows: [{ remaining }], observedAt, staleAt: observedAt + 10000 },
      });
      Object.defineProperty(result, ANTHROPIC_USAGE_OBSERVATION, {
        value: { windows: [{ remaining: nativeQuota }], observedAt, staleAt: observedAt + 300000 },
      });
      return result;
    });
  const requests: Array<{ provider: string; messages: string; token: string | undefined }> = [];
  let probeCalls = 0;
  let events: Pi.ExtensionAPI["events"] | undefined;
  const child = await createChildSession({
    cwd: root,
    agentDir: root,
    projectTrusted: true,
    ...(authProfile === undefined ? {} : { authProfile }),
    model: {
      provider: "presets",
      id: "planning",
      api: "pi-virtual",
      name: "planning",
      baseUrl: "",
      reasoning: true,
      input: ["text"],
      contextWindow: 200000,
      maxTokens: 32000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    config: {
      name: "quota-fixture",
      description: "Local routing fixture",
      prompt: "QUOTA_ROLE_INSTRUCTION",
      model: "presets/planning",
      maxTurns: 3,
      tools: ["preset_probe"],
      excludeTools: ["subagent", "mcp__*"],
      extensions: [],
      skills: [],
    },
    protocol(pi) {
      events = pi.events;
      authProfiles(pi, {
        selectProfile: async () => ({
          profile,
          profileOrder: [profile, "fbb", "default"],
          source: "repository",
          host: { name: "fixture", source: "system hostname" },
          hostPreferences: [],
          repositoryPreferences: [profile],
        }),
        now,
        usageCollector: async (options) => {
          const force = options?.forceUsageRefresh === true;
          if (force) forceRefreshes++;
          return {
            schema: "fbb.pi-auth-profiles-usage/v1",
            profiles: accounts(force),
            diagnostics: [],
          };
        },
      });
      modelPresets(pi);
      for (const provider of ["openai-codex", "anthropic", "claude-bridge"]) {
        pi.registerProvider(provider, {
          api: "openai-completions",
          baseUrl: "https://fixture.invalid",
          ...(provider === "claude-bridge" ? { apiKey: "external-fixture" } : {}),
          models: [
            {
              id: provider === "openai-codex" ? "gpt-6.2-sol" : "claude-sonnet-5-5",
              name: "Fixture",
              reasoning: true,
              thinkingLevelMap: {
                low: "low",
                medium: "medium",
                high: "high",
                xhigh: "xhigh",
                max: "max",
              },
              input: ["text"],
              contextWindow: 200000,
              maxTokens: 32000,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
          streamSimple(model, context, options) {
            requests.push({
              provider,
              messages: JSON.stringify(context.messages),
              token: options?.apiKey,
            });
            const tool = requests.length === 1;
            const message: AssistantMessage = {
              role: "assistant",
              provider,
              api: model.api,
              model: model.id,
              timestamp: Date.now(),
              content: tool
                ? [{ type: "toolCall", id: "probe", name: "preset_probe", arguments: {} }]
                : [{ type: "text", text: "QUOTA_SESSION_OK æ ø å" }],
              stopReason: tool ? "toolUse" : "stop",
              usage: {
                input: 10,
                output: 3,
                totalTokens: 13,
                cacheRead: 0,
                cacheWrite: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
            };
            const stream = createAssistantMessageEventStream();
            stream.push({ type: "start", partial: message });
            stream.push({ type: "done", reason: tool ? "toolUse" : "stop", message });
            return stream;
          },
        });
      }
      pi.registerTool({
        name: "preset_probe",
        label: "Probe",
        description: "Return a fixed observation",
        parameters: Type.Object({}),
        async execute() {
          probeCalls++;
          return {
            content: [{ type: "text", text: "QUOTA_TOOL_OBSERVATION" }],
            details: undefined,
          };
        },
      });
    },
    onUncertainStartup(error) {
      const details = (value: unknown): string =>
        value instanceof AggregateError
          ? value.errors.map(details).join("; ")
          : value instanceof Error
            ? `${value.message}${value.cause ? `: ${details(value.cause)}` : ""}`
            : String(value);
      throw new Error(details(error));
    },
  });
  cleanup.push(child.close);
  if (!events) throw new Error("Missing fixture event bus");
  return {
    child, events, requests, probeCalls: () => probeCalls, root,
    expireOnNextRefresh() {
      const runtime = child.session.modelRuntime;
      const refresh = runtime.refresh.bind(runtime);
      const observations: number[] = [];
      let first = true;
      const spy = spyOn(runtime, "refresh").mockImplementation(async (options) => {
        if (first) {
          first = false;
          clockOffset += 10_001;
        }
        const result = await refresh(options);
        observations.push(result.errors.size);
        return result;
      });
      cleanup.push(() => { spy.mockRestore(); });
      return observations;
    },
    forceRefreshes: () => forceRefreshes,
    setForcedQuota(value: number) { forcedQuota = value; },
  };
}

test("kk routing excludes Claude despite global fbb credentials and fresh bridge quota", async () => {
  const f = await fixture();
  const now = Date.now();
  recordBridgeQuota({
    "anthropic-ratelimit-unified-status": "allowed",
    "anthropic-ratelimit-unified-5h-utilization": "0.2",
    "anthropic-ratelimit-unified-5h-reset": String((now + 3600000) / 1000),
    "anthropic-ratelimit-unified-7d-utilization": "0.3",
    "anthropic-ratelimit-unified-7d-reset": String((now + 86400000) / 1000),
  });
  const eligible = await requestRoutingAccounts(f.events);
  expect(eligible.map(({ provider, profile }) => [provider, profile])).toEqual([
    ["openai-codex", "kk"],
  ]);
  await f.child.session.prompt("QUOTA_ASSIGNMENT: inspect the task and preserve æ ø å");
  expect(f.requests).toHaveLength(2);
  expect(f.probeCalls()).toBe(1);
  for (const request of f.requests) {
    expect(request.provider).toBe("openai-codex");
    expect(request.token).toBe("kk-fixture-token");
    expect(request.messages).toContain("QUOTA_ASSIGNMENT");
    expect(request.messages).toContain("QUOTA_ROLE_INSTRUCTION");
  }
  expect(f.requests[1]?.messages).toContain("QUOTA_TOOL_OBSERVATION");
  expect(f.child.errors).toEqual([]);
});

test("fresh native Anthropic quota can execute independently of unknown bridge quota", async () => {
  const f = await fixture("fbb", 0);
  const eligible = await requestRoutingAccounts(f.events);
  expect(eligible.map(({ provider }) => provider)).toEqual(["anthropic"]);
  await f.child.session.prompt("QUOTA_ASSIGNMENT: inspect this bounded task");
  expect(f.requests.map(({ provider }) => provider)).toEqual(["anthropic", "anthropic"]);
  expect(f.requests.every(({ token }) => token === "native-fixture-token")).toBe(true);
});

test("expiry during a preset rebind refreshes quota once and never restores the expired route", async () => {
  const f = await fixture();
  const [account] = await requestRoutingAccounts(f.events);
  if (!account) throw new Error("Missing eligible account");
  await activateRoutingAccount(f.events, account);
  const observations = f.expireOnNextRefresh();

  await activateRoutingAccount(f.events, account);

  expect(f.forceRefreshes()).toBe(1);
  expect(observations).toEqual([1, 0, 0]);
  const resolved = await f.child.session.modelRuntime.getAuth("openai-codex");
  expect(resolved?.auth.apiKey).toBe("kk-fixture-token");
});

test("expired routing fails closed when the same account has no fresh quota", async () => {
  const f = await fixture();
  const [account] = await requestRoutingAccounts(f.events);
  if (!account) throw new Error("Missing eligible account");
  await activateRoutingAccount(f.events, account);
  const observations = f.expireOnNextRefresh();
  f.setForcedQuota(0);

  await expect(activateRoutingAccount(f.events, account)).rejects.toThrow("no longer eligible");

  expect(f.forceRefreshes()).toBe(1);
  expect(observations).toEqual([1, 0]);
  expect(f.requests).toEqual([]);
});

test("stale quota stops execution and account activation cannot escape profile scope", async () => {
  const f = await fixture("kk", 80, true);
  expect(await requestRoutingAccounts(f.events)).toEqual([]);
  await expect(
    activateRoutingAccount(f.events, {
      provider: "anthropic",
      profile: "fbb",
      remaining: 90,
      observedAt: Date.now(),
      staleAt: Date.now() + 10000,
    }),
  ).rejects.toThrow("no longer eligible");
  await f.child.session.prompt("This must not execute with stale quota");
  expect(f.requests).toEqual([]);
});

test("explicit parent kk override excludes the repository's fbb accounts in the child", async () => {
  const f = await fixture("fbb", 80, false, 65, "kk");
  const eligible = await requestRoutingAccounts(f.events);
  expect(eligible.map(({ provider, profile }) => [provider, profile])).toEqual([
    ["openai-codex", "kk"],
  ]);
  await f.child.session.prompt("Use only the inherited kk account");
  expect(f.requests).toHaveLength(2);
  expect(f.requests.every(({ token }) => token === "kk-fixture-token")).toBe(true);
});

test("fbb bridge executes only with its own fresh quota and remains separate from native exhaustion", async () => {
  const f = await fixture("fbb", 0, false, 0);
  expect(await requestRoutingAccounts(f.events)).toEqual([]);
  const now = Date.now();
  recordBridgeQuota({
    "anthropic-ratelimit-unified-status": "allowed",
    "anthropic-ratelimit-unified-5h-utilization": "0.2",
    "anthropic-ratelimit-unified-5h-reset": String((now + 3600000) / 1000),
    "anthropic-ratelimit-unified-7d-utilization": "0.3",
    "anthropic-ratelimit-unified-7d-reset": String((now + 86400000) / 1000),
  });
  expect((await requestRoutingAccounts(f.events)).map(({ provider }) => provider)).toEqual([
    "claude-bridge",
  ]);
  await f.child.session.prompt("Use the independently eligible bridge account");
  expect(f.requests.map(({ provider }) => provider)).toEqual(["claude-bridge", "claude-bridge"]);
});
