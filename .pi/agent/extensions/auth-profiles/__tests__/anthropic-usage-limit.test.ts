import { describe, expect, test } from "bun:test";
import {
  anthropicExhaustionResetAt,
  anthropicUsageLimitFromMessage,
  hasConfirmedAnthropicUsage,
} from "../providers/anthropic-usage";

const NOW = 1_000_000;
const RATE_LIMIT =
  '429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit."}}';

describe("anthropic usage-limit detection", () => {
  test("recognizes an SDK 429 rate-limit error without a reset time", () => {
    expect(anthropicUsageLimitFromMessage(RATE_LIMIT, NOW)).toEqual({});
  });

  test("uses the server retry delay that exceeded Pi's retry limit", () => {
    expect(
      anthropicUsageLimitFromMessage(
        `Server requested 7200s retry delay (max: 60s). ${RATE_LIMIT}`,
        NOW,
      ),
    ).toEqual({ resetAt: NOW + 7_200_000 });
  });

  test("ignores other errors", () => {
    expect(anthropicUsageLimitFromMessage(undefined, NOW)).toBeUndefined();
    expect(
      anthropicUsageLimitFromMessage('529 {"type":"error","error":{"type":"overloaded_error"}}'),
    ).toBeUndefined();
    expect(anthropicUsageLimitFromMessage('400 {"error":{"type":"rate_limit_error"}}')).toBe(
      undefined,
    );
  });
});

describe("anthropic exhaustion reset", () => {
  test("waits for the latest exhausted window", () => {
    expect(
      anthropicExhaustionResetAt(
        [
          { windowId: "primary", remaining: 0, allowanceResetAt: NOW + 1_000 },
          { windowId: "secondary", remaining: 0, allowanceResetAt: NOW + 9_000 },
        ],
        NOW,
      ),
    ).toBe(NOW + 9_000);
  });

  test("falls back to the 5-hour reset when cached usage lags the 429", () => {
    expect(
      anthropicExhaustionResetAt(
        [
          { windowId: "primary", remaining: 4, allowanceResetAt: NOW + 2_000 },
          { windowId: "secondary", remaining: 50, allowanceResetAt: NOW + 9_000 },
        ],
        NOW,
      ),
    ).toBe(NOW + 2_000);
  });

  test("uses a short cooldown without usage windows", () => {
    expect(anthropicExhaustionResetAt(undefined, NOW)).toBe(NOW + 300_000);
  });

  test("confirms usage only when every window has remaining allowance", () => {
    expect(hasConfirmedAnthropicUsage([{ remaining: 1 }, { remaining: 50 }])).toBe(true);
    expect(hasConfirmedAnthropicUsage([{ remaining: 0 }, { remaining: 50 }])).toBe(false);
    expect(hasConfirmedAnthropicUsage([])).toBe(false);
    expect(hasConfirmedAnthropicUsage(undefined)).toBe(false);
  });
});
