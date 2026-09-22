import { expect, test } from "bun:test";
import { renderRecommendation } from "../recommendation";

test("renders concise advisory outcomes", () => {
  expect(renderRecommendation({ decision: { decision: "recommend", agentId: "analyze" } })).toBe(
    "Recommended: analyze",
  );
  expect(renderRecommendation({ decision: { decision: "stay" } })).toBe("Stay with primary");
  expect(renderRecommendation({ decision: { decision: "abstain", reason: "disabled" } })).toBe(
    "No recommendation",
  );
});
