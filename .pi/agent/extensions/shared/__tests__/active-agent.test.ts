import { describe, expect, test } from "bun:test";
import { activeAgentName } from "../active-agent";

describe("active-agent marker parsing", () => {
  test("returns the first valid marker name from a system prompt", () => {
    expect(activeAgentName('header\n<active_agent name="review" extra="value" />\nfooter')).toBe(
      "review",
    );
    expect(activeAgentName("<active_agent name='visualizer'/>")).toBe("visualizer");
  });

  test("rejects malformed markers and missing prompts", () => {
    expect(activeAgentName(undefined)).toBeUndefined();
    expect(activeAgentName('<active_agent name="" />')).toBeUndefined();
    expect(activeAgentName('<active_agent name="review">')).toBeUndefined();
    expect(activeAgentName('quoted <active_agent name="review" /> text')).toBeUndefined();
  });
});
