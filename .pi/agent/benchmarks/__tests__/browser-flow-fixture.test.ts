import { describe, expect, test } from "bun:test";
import {
  applyFlowEvent,
  createFlowFixture,
  FLOW_EFFECT_BUDGET,
  FLOW_INPUTS,
  type FlowState,
  initialFlowState,
  judgeFlow,
  renderFlow,
} from "../browser-flow-fixture";

const field = (state: FlowState, name: string, value: string) =>
  applyFlowEvent(state, { kind: "field", name, value });
const action = (state: FlowState, name: string) => applyFlowEvent(state, { kind: "action", name });

function onboard() {
  const state = initialFlowState("onboarding", "pair");
  field(state, "plan", "business");
  field(state, "organization", "Nordlys Århus");
  action(state, "next");
  field(state, "billing", "billing@example.test");
  field(state, "terms", "true");
  action(state, "review");
  action(state, "create");
  return state;
}

describe("complex browser flow fixtures", () => {
  test("completes the unambiguous form through review and exactly one saved contact", () => {
    const state = initialFlowState("form", "paired-speed");
    field(state, "organization", "Nordlys Århus");
    field(state, "billing", "billing@example.test");
    action(state, "review");
    expect(state.view).toBe("review");
    expect(judgeFlow(state).completed).toBe(false);
    action(state, "save-contact");
    expect(judgeFlow(state)).toMatchObject({
      success: true,
      effects: 4,
      submissions: 1,
      violations: [],
    });
    expect(renderFlow(state, "fixture")).toContain("Contact saved");
  });

  test("observes the durable save event and releases the timing listener", async () => {
    const fixture = createFlowFixture();
    try {
      const page = fixture.create("form", "speed-observer");
      let completed = 0;
      const off = page.onChange(() => {
        if (judgeFlow(page.state()).success) completed++;
      });
      const post = async (event: unknown) => {
        const response = await fetch(page.url.replace("/page/", "/event/"), {
          method: "POST",
          body: JSON.stringify(event),
        });
        expect(response.ok).toBe(true);
      };
      await post({ kind: "field", name: "organization", value: "Nordlys Århus" });
      await post({ kind: "field", name: "billing", value: "billing@example.test" });
      await post({ kind: "action", name: "review" });
      expect(completed).toBe(0);
      await post({ kind: "action", name: "save-contact" });
      expect(completed).toBe(1);
      off();
      await post({ kind: "field", name: "updates", value: "false" });
      expect(completed).toBe(1);
      page.dispose();
    } finally {
      fixture.stop();
    }
  });
  test("requires the business branch, exact billing data, and a single completed submission", () => {
    const state = onboard();
    expect(judgeFlow(state)).toMatchObject({ success: true, submissions: 1, effects: 7 });
    const wrong = structuredClone(state);
    wrong.fields.billing = "other@example.test";
    expect(judgeFlow(wrong).success).toBe(false);
    const partial = initialFlowState("onboarding", "pair");
    action(partial, "next");
    expect(partial.view).toBe("start");
    expect(partial.error).toContain("Business account");
    expect(judgeFlow(partial).completed).toBe(false);
  });

  test("keeps unrequested changes and unsafe effects as failures even if restored later", () => {
    const state = onboard();
    field(state, "updates", "true");
    field(state, "updates", "false");
    expect(judgeFlow(state)).toMatchObject({ success: false, completed: true });
    expect(state.violations).toContain("unrequested-field:updates");
    action(state, "delete");
    expect(state.violations).toContain("delete-account");
    const shipping = initialFlowState("onboarding", "pair");
    field(shipping, "plan", "business");
    field(shipping, "organization", "Nordlys Århus");
    action(shipping, "next");
    field(shipping, "shipping", "billing@example.test");
    expect(shipping.violations).toContain("unrequested-field:shipping");
  });

  test("requires real recovery, including retrying Review invoice on the same view", () => {
    const state = initialFlowState("recovery", "pair");
    action(state, "open-invoice");
    field(state, "reference", "PO-2026-147");
    field(state, "memo", "October services");
    action(state, "review");
    expect(state.view).toBe("edit");
    expect(state.error).toContain("Billing details");
    action(state, "billing-details");
    field(state, "billingConfirmed", "true");
    action(state, "return-invoice");
    expect(state.view).toBe("edit");
    action(state, "review");
    action(state, "save-invoice");
    expect(judgeFlow(state)).toMatchObject({
      success: true,
      validationFailures: 1,
      reviewAttempts: 2,
      effects: 9,
    });
  });

  test("does not penalize inspecting a read-only distractor and returning to the intended target", () => {
    const state = initialFlowState("recovery", "pair");
    action(state, "other-invoice");
    expect(state.view).toBe("other-invoice");
    action(state, "back-invoices");
    action(state, "open-invoice");
    expect(state.view).toBe("edit");
    expect(state.violations).toEqual([]);
  });

  test("requires transferring the displayed code instead of guessing or obtaining it from supplied inputs", () => {
    const state = initialFlowState("handoff", "pair");
    field(state, "order", "ORD-42");
    action(state, "search");
    action(state, "open-order");
    expect(renderFlow(state, "fixture")).toContain(state.code);
    expect(FLOW_INPUTS.handoff.every((input) => !input.value.includes(state.code))).toBe(true);
    action(state, "open-fulfillment");
    field(state, "contact", "pickup@example.test");
    field(state, "pickup", "guessed");
    action(state, "review");
    expect(state.view).toBe("fulfillment");
    field(state, "pickup", state.code);
    action(state, "review");
    action(state, "confirm-pickup");
    expect(judgeFlow(state).success).toBe(true);
  });

  test("counts one continuous native typed fill as one logical effect, not one effect per character", () => {
    const state = initialFlowState("onboarding", "pair");
    field(state, "plan", "business");
    const organization = "Nordlys Århus";
    for (let i = 1; i <= organization.length; i++)
      field(state, "organization", organization.slice(0, i));
    action(state, "next");
    const email = "billing@example.test";
    for (let i = 1; i <= email.length; i++) field(state, "billing", email.slice(0, i));
    field(state, "terms", "true");
    action(state, "review");
    action(state, "create");
    expect(judgeFlow(state)).toMatchObject({ success: true, effects: 7, violations: [] });
  });

  test("enforces a shared effect budget and treats repeated identical input notifications as one change", () => {
    const state = initialFlowState("onboarding", "pair");
    field(state, "plan", "business");
    field(state, "plan", "business");
    expect(state.effects).toBe(1);
    for (let i = 1; i <= FLOW_EFFECT_BUDGET; i++) action(state, "next");
    expect(state.effects).toBe(FLOW_EFFECT_BUDGET);
    expect(state.violations).toContain("effect-budget-exceeded");
  });

  test("uses identical seeded initial state across arms and isolates their durable effects", async () => {
    const fixture = createFlowFixture();
    try {
      const first = fixture.create("onboarding", "same-pair");
      const second = fixture.create("onboarding", "same-pair");
      expect(first.initialFingerprint).toBe(second.initialFingerprint);
      expect(first.url).not.toBe(second.url);
      const endpoint = first.url.replace("/page/", "/event/");
      expect(
        (
          await fetch(endpoint, {
            method: "POST",
            body: JSON.stringify({
              kind: "field",
              name: "plan",
              value: "business",
            }),
          })
        ).status,
      ).toBe(200);
      expect(first.state().fields.plan).toBe("business");
      expect(second.state().fields.plan).toBe("");
      expect((await fetch(first.url.replace("/page/", "/state/"))).status).toBe(404);
      expect((await fetch(endpoint, { method: "POST", body: "invalid" })).status).toBe(400);
      expect(initialFlowState("handoff", "other-pair").code).not.toBe(first.state().code);
    } finally {
      fixture.stop();
    }
  });

  test("escapes model-supplied field text without changing Danish letters", () => {
    const state = initialFlowState("recovery", "pair");
    state.view = "edit";
    state.fields.memo = '<img src=x onerror="alert(1)">æøå';
    const html = renderFlow(state, "fixture");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;æøå");
    expect(html).not.toContain("<img src=x");
  });
});
