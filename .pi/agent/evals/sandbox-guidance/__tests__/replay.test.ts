import { expect, test } from "bun:test";
import { replayAttempt } from "../replay";

function attempt() {
  return {
    row: {
      id: "network-listed",
      arm: "candidate",
      repeat: 0,
      infraError: null,
      elapsedMs: 1,
      calls: 0,
      tokens: 10,
      estimatedCostUSD: 0,
    },
    reply: '{"status":"done","network":"unknown","needsUserChange":false}',
    trace: [],
    files: {},
  };
}
test("replay scores saved responses without modifying the evidence", () => {
  const input = attempt();
  const before = JSON.stringify(input);
  expect(replayAttempt(input).score.passed).toBe(true);
  expect(JSON.stringify(input)).toBe(before);
});
test("replay preserves infrastructure failures rather than counting them as usable", () => {
  const input = { ...attempt(), row: { ...attempt().row, infraError: "timeout" } };
  expect(replayAttempt(input).infraError).toBe("timeout");
});
test("replay rejects malformed identities and trace entries", () => {
  expect(() =>
    replayAttempt({ ...attempt(), row: { ...attempt().row, id: "../outside" } }),
  ).toThrow();
  expect(() => replayAttempt({ ...attempt(), trace: [{ result: "ok" }] })).toThrow();
  expect(() => replayAttempt({ ...attempt(), reply: null })).toThrow();
  expect(() => replayAttempt({ ...attempt(), files: { "/tmp/x": 1 } })).toThrow();
});
test("replay retains genuine network-claim failures", () => {
  expect(
    replayAttempt({
      ...attempt(),
      reply: '{"status":"done","network":"unrestricted","needsUserChange":false}',
    }).score.passed,
  ).toBe(false);
});
