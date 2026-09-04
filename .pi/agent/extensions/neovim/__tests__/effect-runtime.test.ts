import { expect, test } from "bun:test";
import { NeovimEffectScope, repeatPromiseWhile, runWithTimeout } from "../effect-runtime";

test("Effect runtime preserves Promise failures and applies the requested deadline", async () => {
  const original = new Error("original failure");
  expect(runWithTimeout(Promise.reject(original), "timed out", 100)).rejects.toBe(original);
  expect(runWithTimeout(new Promise(() => undefined), "timed out", 1)).rejects.toThrow("timed out");
});

test("Effect repetition stops on the accepted result and respects the attempt bound", async () => {
  let acceptedAttempts = 0;
  const accepted = await repeatPromiseWhile(
    async () => {
      acceptedAttempts += 1;
      return acceptedAttempts;
    },
    (attempt) => attempt < 3,
    { delayMs: 1, maxAttempts: 5 },
  );
  expect(accepted).toBe(3);
  expect(acceptedAttempts).toBe(3);

  let boundedAttempts = 0;
  const bounded = await repeatPromiseWhile(
    async () => {
      boundedAttempts += 1;
      return boundedAttempts;
    },
    () => true,
    { delayMs: 1, maxAttempts: 2 },
  );
  expect(bounded).toBe(2);
  expect(boundedAttempts).toBe(2);
});

test("Effect scope releases an acquired connection exactly once", async () => {
  const scope = new NeovimEffectScope();
  const released: object[] = [];
  const connection = {};

  expect(
    await scope.acquire(
      async () => connection,
      async (value) => {
        released.push(value);
      },
    ),
  ).toBe(connection);
  expect(released).toEqual([]);

  await Promise.all([scope.close(), scope.close()]);
  expect(released).toEqual([connection]);
});
