import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import {
  bridgeSubscriptionEnvironment,
  parseBridgeQuota,
  readBridgeQuota,
  recordBridgeQuota,
} from "../bridge-quota";
import {
  activateRoutingAccount,
  installRoutingEligibilityService,
  type RoutingAccount,
  requestRoutingAccounts,
} from "../routing-eligibility";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
const now = 1_000_000;
const account: RoutingAccount = {
  provider: "openai-codex",
  profile: "kk",
  remaining: 50,
  observedAt: now,
  staleAt: now + 10000,
};
const headers = {
  "anthropic-ratelimit-unified-status": "allowed",
  "anthropic-ratelimit-unified-5h-utilization": "0.2",
  "anthropic-ratelimit-unified-5h-reset": String((now + 300000) / 1000),
  "anthropic-ratelimit-unified-7d-utilization": "0.3",
  "anthropic-ratelimit-unified-7d-reset": String((now + 600000) / 1000),
};

test("correlates independent session-local eligibility requests and activations", async () => {
  const events = createEventBus();
  const activated: RoutingAccount[] = [];
  cleanup.push(
    installRoutingEligibilityService(events, {
      list: async () => [account],
      activate: async (candidate) => {
        activated.push(candidate);
      },
    }),
  );
  expect(
    await Promise.all([requestRoutingAccounts(events), requestRoutingAccounts(events)]),
  ).toEqual([[account], [account]]);
  await activateRoutingAccount(events, account);
  expect(activated).toEqual([account]);
  await expect(requestRoutingAccounts(createEventBus())).rejects.toThrow("unavailable");
});

test("propagates cancellation into pending activation before side effects", async () => {
  const events = createEventBus();
  const controller = new AbortController();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let activated = false;
  cleanup.push(
    installRoutingEligibilityService(events, {
      list: async () => [account],
      activate: async (_account, signal) => {
        await gate;
        signal.throwIfAborted();
        activated = true;
      },
    }),
  );
  const pending = activateRoutingAccount(events, account, controller.signal);
  controller.abort(new Error("Fixture cancellation"));
  release?.();
  await expect(pending).rejects.toThrow("Fixture cancellation");
  expect(activated).toBe(false);
});

test("rejects invalid eligibility data and service errors", async () => {
  const events = createEventBus();
  const dispose = installRoutingEligibilityService(events, {
    list: async () => [{ ...account, remaining: 0 }],
    activate: async () => {},
  });
  await expect(requestRoutingAccounts(events)).rejects.toThrow("invalid accounts");
  dispose();
  cleanup.push(
    installRoutingEligibilityService(events, {
      list: async () => {
        throw new Error("Usage unavailable");
      },
      activate: async () => {},
    }),
  );
  await expect(requestRoutingAccounts(events)).rejects.toThrow("Usage unavailable");
});

test("bridge quota has independent fbb ownership and expires on short TTL", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-quota-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "observation.json");
  recordBridgeQuota(headers, now, path);
  const observation = readBridgeQuota(now, path);
  expect(observation?.provider).toBe("claude-bridge");
  expect(observation?.profile).toBe("fbb");
  expect(observation?.remaining).toBe(70);
  expect(readBridgeQuota(now + 60001, path)).toBeUndefined();
  recordBridgeQuota({ "anthropic-ratelimit-unified-status": "rejected" }, now + 1, path);
  expect(readBridgeQuota(now + 1, path)).toBeUndefined();
  await writeFile(
    path,
    JSON.stringify({
      schema: "fbb.auth-bridge-quota/v1",
      observation: { ...account, provider: "claude-bridge", profile: "kk" },
    }),
  );
  expect(readBridgeQuota(now, path)).toBeUndefined();
});

test("unknown, exhausted, malformed, or incomplete bridge windows never grant availability", () => {
  expect(parseBridgeQuota({}, now)).toBeUndefined();
  for (const utilization of ["1", "NaN", "-1", "2"]) {
    expect(
      parseBridgeQuota(
        { ...headers, "anthropic-ratelimit-unified-5h-utilization": utilization },
        now,
      ),
    ).toBeUndefined();
  }
  expect(
    parseBridgeQuota({ ...headers, "anthropic-ratelimit-unified-7d-reset": "" }, now),
  ).toBeUndefined();
  expect(
    parseBridgeQuota({ ...headers, "anthropic-ratelimit-unified-status": "rejected" }, now),
  ).toBeUndefined();
  for (const name of [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_USE_BEDROCK",
  ]) {
    expect(bridgeSubscriptionEnvironment({ [name]: "fixture" })).toBe(false);
  }
  expect(bridgeSubscriptionEnvironment({})).toBe(true);
});
