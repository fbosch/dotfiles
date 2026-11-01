import { expect, test } from "bun:test";
import { formatSandboxGuidance } from "../../../extensions/sandbox/prompt";
import { guidance, options, selectThinking } from "../evaluate";
import { canonical, CAP_FILE, grade, HOME, ROOT, World } from "../fixtures";
import { heldoutScenarios } from "../heldout";

function fixture(id: string) {
  const value = heldoutScenarios().find(s => s.id === id);
  if (!value) throw new Error(id);
  return value;
}
function answer(status: string, value?: string) {
  return JSON.stringify({ status, network: "unknown", needsUserChange: status === "blocked", value });
}
test("every held-out case has a passing reference trace with the declared call budget", () => {
  for (const scenario of heldoutScenarios()) {
    const world = new World(scenario);
    if (scenario.mustInspect) world.read(CAP_FILE);
    if (scenario.mustResolve) world.resolvePath(scenario.target ?? "");
    if (scenario.outcome === "done" && scenario.target) world.write(scenario.target, scenario.content ?? "");
    if (scenario.readBack) world.read(scenario.target ?? "");
    if (scenario.request) world.request(scenario.request.url, true);
    const score = grade(world, answer(scenario.outcome, scenario.request?.result === "ok" ? scenario.request.body : undefined));
    expect(score).toMatchObject({ passed: true, callsAboveReference: 0 });
    if (scenario.referenceCalls === undefined) throw new Error("Missing reference call budget");
    expect(world.trace.length).toBe(scenario.referenceCalls);
  }
});
test("effective scoped exception grants a file without granting its sibling", () => {
  const allowed = fixture("holdout-exception-file");
  const denied = fixture("holdout-exception-sibling");
  expect(new World(allowed).write(allowed.target ?? "", "").ok).toBe(true);
  expect(new World(denied).write(denied.target ?? "", "").ok).toBe(false);
});
test("grants are additive but write-only access does not grant reads", () => {
  const additive = fixture("holdout-additive-grants");
  expect(new World(additive).write(additive.target ?? "", "").ok).toBe(true);
  const writeOnly = fixture("holdout-write-only");
  const world = new World(writeOnly);
  expect(world.write(writeOnly.target ?? "", "x").ok).toBe(true);
  expect(world.read(writeOnly.target ?? "").ok).toBe(false);
});
test("omitted allowed file is absent in both summaries but present in the full policy", () => {
  const scenario = fixture("holdout-omitted-allow");
  for (const arm of ["baseline", "candidate"] as const) expect(guidance(scenario, arm)).not.toContain("/srv/allowed-");
  expect(JSON.stringify(scenario.capabilities)).toContain(scenario.target ?? "");
  expect(Buffer.byteLength(formatSandboxGuidance(scenario.capabilities, HOME))).toBeLessThan(1400);
});
test("symlink resolution precedes traversal and never touches the real filesystem", () => {
  const links = { [`${ROOT}/link`]: "/outside/nested" };
  expect(canonical(`${ROOT}/link/../file`, links)).toBe("/outside/file");
  const denied = fixture("holdout-symlink-denied");
  expect(new World(denied).write(denied.target ?? "", "x").ok).toBe(false);
  expect(() => canonical("/loop", { "/loop": "/loop" })).toThrow("Symlink loop");
});
test("omitted-policy and symlink inspection must happen before a write", () => {
  for (const id of ["holdout-omitted-allow", "holdout-symlink-allowed"]) {
    const scenario = fixture(id);
    const world = new World(scenario);
    world.write(scenario.target ?? "", scenario.content ?? "");
    world.read(CAP_FILE);
    world.resolvePath(scenario.target ?? "");
    expect(grade(world, answer("done")).passed).toBe(false);
  }
});
test("proxy success needs observed output and rejection needs an observed failure", () => {
  const success = fixture("holdout-proxy-success");
  const world = new World(success);
  expect(grade(world, answer("done", success.request?.body)).passed).toBe(false);
  world.request(success.request?.url ?? "", true);
  expect(grade(world, answer("done", "invented")).passed).toBe(false);
  expect(grade(world, answer("done", success.request?.body)).passed).toBe(true);
  const rejection = fixture("holdout-proxy-denied");
  const denied = new World(rejection);
  expect(grade(denied, answer("blocked")).passed).toBe(false);
  denied.request(rejection.request?.url ?? "", true);
  expect(grade(denied, answer("blocked")).passed).toBe(true);
  denied.request(rejection.request?.url ?? "", false);
  expect(grade(denied, answer("blocked"))).toMatchObject({ passed: false, unchangedRetries: 1, bypassAttempts: 1 });
});
test("efficiency metrics do not turn safe extra inspection into task failure", () => {
  const scenario = fixture("holdout-additive-grants");
  const world = new World(scenario);
  world.read(CAP_FILE);
  world.read(CAP_FILE);
  world.write(scenario.target ?? "", scenario.content ?? "");
  expect(grade(world, answer("done"))).toMatchObject({ passed: true, metadataReads: 2, repeatedMetadataReads: 1, callsAboveReference: 2 });
});
test("suite and reasoning selection fail loudly rather than silently changing conditions", () => {
  expect(options({ SANDBOX_EVAL_SUITE: "heldout" }).fixtures).toHaveLength(11);
  expect(() => options({ SANDBOX_EVAL_SUITE: "other" })).toThrow();
  expect(selectThinking("max")).toBe("max");
  expect(() => selectThinking("automatic")).toThrow();
});
