import { describe, expect, test } from "bun:test";
import {
  applyStepSafety,
  createStepSafetyRequest,
  evaluateStepDecision,
  parseClickCandidates,
  parseStepSafety,
} from "../index";

const learnMoreCandidate = {
  id: "e1",
  ref: "@e1",
  label: "Learn more",
  description: "Click Learn more at @e1.",
};
const candidates = [
  learnMoreCandidate,
  { id: "e2", ref: "@e2", label: "Continue", description: "Click Continue at @e2." },
];

describe("browser step", () => {
  test("extracts bounded link and button candidates from a snapshot", () => {
    expect(
      parseClickCandidates(
        '- heading "Example" [ref=e0]\n- link "Learn more" [ref=e1, url=https://example.com]\n- button "Continue" [ref=e2]\n- textbox "Email" [ref=e3]',
      ),
    ).toEqual(candidates);
  });

  test("requires the selected action to meet its confidence threshold", () => {
    expect(
      evaluateStepDecision(
        { choice: "e1", probabilities: { e1: 0.7, e2: 0.2, no_action: 0.1 } },
        candidates,
        0.75,
      ),
    ).toEqual({
      executed: false,
      reason: "low_confidence",
      candidate: learnMoreCandidate,
      probability: 0.7,
    });

    expect(
      evaluateStepDecision(
        { choice: "no_action", probabilities: { e1: 0.1, e2: 0.1, no_action: 0.8 } },
        candidates,
        0.75,
      ),
    ).toEqual({ executed: false, reason: "no_action", probability: 0.8 });
  });

  test("builds and parses a Jev navigation-safety judgment", () => {
    expect(createStepSafetyRequest("Read more", "page", learnMoreCandidate)).toEqual({
      state: { objective: "Read more", page_state: "page", selected_action: learnMoreCandidate },
      questions: {
        navigation_only: {
          type: "noul",
          instructions:
            "Is the selected click strictly a reversible navigation action that only changes the viewed page or opens navigation?",
          criteria: {
            true: "The click only navigates or reveals navigation and does not commit an external effect.",
            false:
              "The click may submit data, mutate state, communicate, purchase, delete, change permissions or accounts, or its effect is uncertain.",
          },
        },
      },
    });
    expect(parseStepSafety({ answers: { navigation_only: { type: "noul", noul: 0.96 } } })).toBe(
      0.96,
    );
    expect(
      parseStepSafety({ answers: { navigation_only: { type: "noul", noul: 2 } } }),
    ).toBeUndefined();
  });

  test("fails closed when Jev is uncertain that the click is navigation-only", () => {
    const selected = evaluateStepDecision(
      { choice: "e1", probabilities: { e1: 0.9, e2: 0.05, no_action: 0.05 } },
      candidates,
      0.75,
    );

    expect(applyStepSafety(selected, 0.7)).toEqual({
      ...selected,
      executed: false,
      reason: "unsafe_or_uncertain",
      safetyProbability: 0.7,
    });
    expect(applyStepSafety(selected, 0.95)).toEqual({
      ...selected,
      safetyProbability: 0.95,
    });
  });
});
