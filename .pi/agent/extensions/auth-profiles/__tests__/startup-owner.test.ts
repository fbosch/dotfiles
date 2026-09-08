import { describe, expect, test } from "bun:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import {
  createStartupOwnerRequest,
  STARTUP_OWNER_SNAPSHOT_EVENT,
  type StartupOwnerSnapshot,
} from "../../startup-header/contracts";
import { openAiCodexUsageFromPayload } from "../providers/openai-codex";
import { AuthStartupOwner, type AuthStartupState } from "../startup-owner";

class FakeClock {
  public current = 100;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  public now = (): number => this.current;
  public setTimeout = (callback: () => void, delay: number): number => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.current + delay, callback });
    return id;
  };
  public clearTimeout = (id: number): void => void this.timers.delete(id);
  public advanceTo(time: number): void {
    this.current = time;
    for (const [id, timer] of [...this.timers]) {
      if (timer.at <= time) {
        this.timers.delete(id);
        timer.callback();
      }
    }
  }
  public get pending(): number {
    return this.timers.size;
  }
  public get nextDelay(): number | undefined {
    const next = Math.min(...[...this.timers.values()].map(({ at }) => at));
    return Number.isFinite(next) ? next - this.current : undefined;
  }
}

function state(overrides: Partial<AuthStartupState> = {}): AuthStartupState {
  return {
    activeProfile: "work",
    profileOrder: ["work", "personal"],
    observations: [
      {
        profileLabel: "work",
        method: "oauth",
        provider: "openai-codex",
        windows: [
          { windowId: "primary", remaining: 43, allowanceResetAt: 150 },
          { windowId: "secondary", remaining: 70, allowanceResetAt: 200 },
        ],
        bankedResetCount: 1,
        bankedExpiryAt: 175,
        observedAt: 100,
        staleAt: 125,
      },
      {
        profileLabel: "personal",
        windows: [{ windowId: "primary", remaining: 80 }],
        observedAt: 100,
        staleAt: 125,
      },
    ],
    ...overrides,
  };
}

describe("auth startup owner", () => {
  test("parses stable public windows and absolute allowance resets", () => {
    expect(
      openAiCodexUsageFromPayload(
        {
          rate_limit: {
            primary_window: { used_percent: 20, reset_after_seconds: 30 },
            secondary_window: { used_percent: 40, reset_after_seconds: 60 },
          },
        },
        100,
      ).windows,
    ).toEqual([
      { windowId: "primary", remaining: 80, resetsIn: "30s", allowanceResetAt: 30_100 },
      { windowId: "secondary", remaining: 60, resetsIn: "1m", allowanceResetAt: 60_100 },
    ]);
  });
  test("publishes only sanitized observed state in resolver and provider-window order", () => {
    const events = createEventBus();
    const snapshots: StartupOwnerSnapshot[] = [];
    events.on(STARTUP_OWNER_SNAPSHOT_EVENT, (value) =>
      snapshots.push(value as StartupOwnerSnapshot),
    );
    const clock = new FakeClock();
    new AuthStartupOwner(events, () => state(), clock);

    events.emit(
      "dotfiles:pi-startup-header/request/v1",
      createStartupOwnerRequest("s", "g", "auth"),
    );
    expect(snapshots[0]).toMatchObject({
      state: "ready",
      observedAt: 100,
      staleAt: 125,
      expiresAt: 175,
    });
    expect(snapshots[0]?.payload).toEqual({
      activeProfile: "work",
      profiles: [
        {
          profileLabel: "work",
          status: "reported",
          method: "oauth",
          provider: "openai-codex",
          windows: [
            { windowId: "primary", remaining: 43, allowanceResetAt: 150 },
            { windowId: "secondary", remaining: 70, allowanceResetAt: 200 },
          ],
          bankedResetCount: 1,
          bankedExpiryAt: 175,
          observedAt: 100,
          staleAt: 125,
        },
        {
          profileLabel: "personal",
          status: "reported",
          windows: [{ windowId: "primary", remaining: 80 }],
          observedAt: 100,
          staleAt: 125,
        },
      ],
    });
    expect(JSON.stringify(snapshots)).not.toContain("access-token");
  });

  test("expires stale observations while suppressing zero-banked expiry metadata", () => {
    const events = createEventBus();
    const clock = new FakeClock();
    const snapshots: StartupOwnerSnapshot[] = [];
    events.on(STARTUP_OWNER_SNAPSHOT_EVENT, (value) =>
      snapshots.push(value as StartupOwnerSnapshot),
    );
    let reads = 0;
    const owner = new AuthStartupOwner(
      events,
      () => {
        reads += 1;
        return state({
          observations: [
            {
              ...(state().observations[0] as AuthStartupState["observations"][number]),
              bankedResetCount: 0,
              bankedExpiryAt: 175,
            },
          ],
        });
      },
      clock,
    );
    events.emit(
      "dotfiles:pi-startup-header/request/v1",
      createStartupOwnerRequest("s", "g", "auth"),
    );
    expect(snapshots[0]?.expiresAt).toBeUndefined();
    expect(
      (snapshots[0]?.payload as { profiles: { bankedExpiryAt?: number }[] } | undefined)
        ?.profiles[0]?.bankedExpiryAt,
    ).toBeUndefined();
    expect(clock.pending).toBe(1);
    clock.advanceTo(125);
    expect(snapshots.at(-1)).toMatchObject({ state: "degraded", staleAt: 125 });
    expect(reads).toBe(2);
    owner.dispose();
    expect(clock.pending).toBe(0);
  });

  test("checkpoints deadlines beyond the runtime timer limit", () => {
    const events = createEventBus();
    const clock = new FakeClock();
    const maximumDelay = 2_147_483_647;
    const deadline = clock.current + maximumDelay + 5_000;
    const owner = new AuthStartupOwner(
      events,
      () =>
        state({
          profileOrder: ["work"],
          observations: [
            {
              profileLabel: "work",
              windows: [{ windowId: "primary", remaining: 43, allowanceResetAt: deadline }],
              observedAt: clock.current,
              staleAt: deadline,
            },
          ],
        }),
      clock,
    );
    events.emit(
      "dotfiles:pi-startup-header/request/v1",
      createStartupOwnerRequest("s", "g", "auth"),
    );

    expect(clock.nextDelay).toBe(maximumDelay);
    clock.advanceTo(clock.current + maximumDelay);
    expect(clock.nextDelay).toBe(5_000);
    owner.dispose();
  });

  test("uses the current profile when switches happen before and after a deadline", () => {
    const events = createEventBus();
    const clock = new FakeClock();
    const snapshots: StartupOwnerSnapshot[] = [];
    let activeProfile = "work";
    events.on(STARTUP_OWNER_SNAPSHOT_EVENT, (value) =>
      snapshots.push(value as StartupOwnerSnapshot),
    );
    const owner = new AuthStartupOwner(events, () => state({ activeProfile }), clock);
    events.emit(
      "dotfiles:pi-startup-header/request/v1",
      createStartupOwnerRequest("s", "g", "auth"),
    );

    clock.advanceTo(124);
    activeProfile = "personal";
    owner.update();
    clock.advanceTo(125);
    expect(snapshots.at(-1)?.payload).toMatchObject({ activeProfile: "personal" });

    activeProfile = "work";
    owner.update();
    expect(snapshots.at(-1)?.payload).toMatchObject({ activeProfile: "work" });
    owner.dispose();
  });

  test("ignores disposed and replaced-generation deadline callbacks", () => {
    const events = createEventBus();
    const clock = new FakeClock();
    const snapshots: StartupOwnerSnapshot[] = [];
    events.on(STARTUP_OWNER_SNAPSHOT_EVENT, (value) =>
      snapshots.push(value as StartupOwnerSnapshot),
    );
    const owner = new AuthStartupOwner(events, () => state(), clock);
    events.emit(
      "dotfiles:pi-startup-header/request/v1",
      createStartupOwnerRequest("s", "g1", "auth"),
    );
    events.emit(
      "dotfiles:pi-startup-header/request/v1",
      createStartupOwnerRequest("s", "g2", "auth"),
    );
    clock.advanceTo(125);
    expect(snapshots.filter((snapshot) => snapshot.generationId === "g1")).toHaveLength(1);
    owner.dispose();
    const before = snapshots.length;
    clock.advanceTo(200);
    expect(snapshots).toHaveLength(before);
  });
});
