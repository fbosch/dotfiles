import { describe, expect, test } from "bun:test";
import { browserArgs, createDecisionRequest, parseDecision } from "../index";

describe("agent-browser extension", () => {
  test("always scopes commands to a sanitized Lightpanda session", () => {
    expect(browserArgs("session/id with spaces", ["open", "https://example.com"])).toEqual([
      "--engine",
      "lightpanda",
      "--session",
      "pi-session-id-with-spaces",
      "open",
      "https://example.com",
    ]);
  });

  test("builds a bounded choice request from explicit candidate actions", () => {
    expect(
      createDecisionRequest({
        objective: "Open settings",
        pageState: '- button "Menu" [ref=e1]',
        actions: [{ id: "menu", description: "Click @e1 to open the menu" }],
      }),
    ).toEqual({
      state: {
        objective: "Open settings",
        page_state: '- button "Menu" [ref=e1]',
        candidate_actions: [{ id: "menu", description: "Click @e1 to open the menu" }],
      },
      questions: {
        next_action: {
          type: "choice",
          instructions:
            "Which supplied action best advances the objective based only on the observed page state? Choose no_action when evidence is insufficient or no action is appropriate.",
          criteria: {
            menu: "Click @e1 to open the menu",
            no_action: "None of the supplied actions safely advances the objective.",
          },
        },
      },
    });
  });

  test("accepts a complete calibrated decision", () => {
    expect(
      parseDecision(
        {
          answers: {
            next_action: {
              type: "choice",
              choice: "menu",
              probabilities: { menu: 0.9, no_action: 0.1 },
            },
          },
        },
        ["menu"],
      ),
    ).toEqual({ choice: "menu", probabilities: { menu: 0.9, no_action: 0.1 } });
  });

  test("rejects incomplete or malformed decisions", () => {
    expect(
      parseDecision(
        {
          answers: {
            next_action: {
              type: "choice",
              choice: "menu",
              probabilities: { menu: 1 },
            },
          },
        },
        ["menu"],
      ),
    ).toBeUndefined();

    expect(
      parseDecision(
        {
          answers: {
            next_action: {
              type: "choice",
              choice: "unknown",
              probabilities: { menu: 0.5, no_action: 0.5 },
            },
          },
        },
        ["menu"],
      ),
    ).toBeUndefined();
  });
});
