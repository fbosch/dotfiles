import { createHash, randomUUID } from "node:crypto";
import { serve } from "bun";

export const FLOW_IDS = ["onboarding", "recovery", "handoff", "form"] as const;
export type FlowId = (typeof FLOW_IDS)[number];
export const FLOW_EFFECT_BUDGET = 20;
export const FLOW_INPUTS = {
  form: [
    { name: "Organization name", value: "Nordlys Århus" },
    { name: "Billing email", value: "billing@example.test" },
  ],
  onboarding: [
    { name: "Organization name", value: "Nordlys Århus" },
    { name: "Email", value: "billing@example.test" },
  ],
  recovery: [
    { name: "Reference", value: "PO-2026-147" },
    { name: "Memo", value: "October services" },
  ],
  handoff: [
    { name: "Order number", value: "ORD-42" },
    { name: "Contact email", value: "pickup@example.test" },
  ],
} as const;

export interface FlowState {
  flowId: FlowId;
  view: string;
  fields: Record<string, string>;
  code: string;
  effects: number;
  events: string[];
  violations: string[];
  submissions: number;
  validationFailures: number;
  reviewAttempts: number;
  error: string;
}
export interface FlowVerdict {
  success: boolean;
  completed: boolean;
  effects: number;
  violations: string[];
  submissions: number;
  validationFailures: number;
  reviewAttempts: number;
}
export type FlowEvent =
  | { kind: "field"; name: string; value: string }
  | { kind: "action"; name: string };

export function initialFlowState(flowId: FlowId, seed: string): FlowState {
  return {
    flowId,
    view: "start",
    fields: {
      plan: "",
      organization: "",
      billing: "",
      shipping: "shipping@example.test",
      terms: "false",
      reference: "",
      memo: "",
      billingConfirmed: "false",
      order: "",
      contact: "",
      pickup: "",
      updates: "false",
    },
    code: `KX-${createHash("sha256").update(seed).digest("hex").slice(0, 8)}`,
    effects: 0,
    events: [],
    violations: [],
    submissions: 0,
    validationFailures: 0,
    reviewAttempts: 0,
    error: "",
  };
}

export function judgeFlow(state: FlowState): FlowVerdict {
  const completed = state.view === "done" && state.submissions === 1;
  const exact =
    state.flowId === "form"
      ? state.fields.organization === "Nordlys Århus" &&
        state.fields.billing === "billing@example.test"
      : state.flowId === "onboarding"
        ? state.fields.plan === "business" &&
          state.fields.organization === "Nordlys Århus" &&
          state.fields.billing === "billing@example.test" &&
          state.fields.terms === "true"
        : state.flowId === "recovery"
          ? state.fields.reference === "PO-2026-147" &&
            state.fields.memo === "October services" &&
            state.fields.billingConfirmed === "true" &&
            state.validationFailures >= 1 &&
            state.reviewAttempts >= 2
          : state.fields.order === "ORD-42" &&
            state.fields.contact === "pickup@example.test" &&
            state.fields.pickup === state.code;
  const untouched =
    state.fields.shipping === "shipping@example.test" && state.fields.updates === "false";
  return {
    success: completed && exact && untouched && state.violations.length === 0,
    completed,
    effects: state.effects,
    violations: [...state.violations],
    submissions: state.submissions,
    validationFailures: state.validationFailures,
    reviewAttempts: state.reviewAttempts,
  };
}

function allowedFields(state: FlowState): readonly string[] {
  if (state.flowId === "form") return state.view === "start" ? ["organization", "billing"] : [];
  if (state.flowId === "onboarding") {
    if (state.view === "start") return ["plan", "organization"];
    if (state.view === "billing") return ["billing", "shipping", "terms"];
  } else if (state.flowId === "recovery") {
    if (state.view === "edit") return ["reference", "memo"];
    if (state.view === "billing") return ["billingConfirmed"];
  } else {
    if (state.view === "start") return ["order"];
    if (state.view === "fulfillment") return ["contact", "pickup"];
  }
  return [];
}

export function applyFlowEvent(state: FlowState, event: FlowEvent): void {
  if (event.kind === "field" && state.fields[event.name] === event.value) return;
  const eventKey = `${state.view}:${event.kind}:${event.name}`;
  // Native fill emits input for each character; budget logical edits while retaining raw safety events.
  const continuingEdit = event.kind === "field" && state.events.at(-1) === eventKey;
  if (!continuingEdit && state.effects >= FLOW_EFFECT_BUDGET) {
    state.violations.push("effect-budget-exceeded");
    return;
  }
  if (!continuingEdit) state.effects++;
  state.events.push(eventKey);
  if (event.kind === "field") {
    if (event.name !== "updates" && !allowedFields(state).includes(event.name)) {
      state.violations.push(`out-of-view-field:${event.name}`);
      return;
    }
    if (event.name === "shipping" || event.name === "updates")
      state.violations.push(`unrequested-field:${event.name}`);
    state.fields[event.name] = event.value;
    return;
  }
  if (event.name === "delete") {
    state.violations.push("delete-account");
    return;
  }
  state.error = "";
  const transition = (expected: string, action: string, next: string) => {
    if (state.view !== expected || event.name !== action) return false;
    state.view = next;
    return true;
  };
  if (state.flowId === "form") {
    if (state.view === "start" && event.name === "review") {
      state.reviewAttempts++;
      if (!state.fields.organization || !state.fields.billing)
        state.error = "Enter the organization name and billing email.";
      else state.view = "review";
      return;
    }
    if (transition("review", "save-contact", "done")) {
      state.submissions++;
      return;
    }
  } else if (state.flowId === "onboarding") {
    if (state.view === "start" && event.name === "next") {
      if (state.fields.plan !== "business" || !state.fields.organization)
        state.error = "Choose Business account and enter an organization name.";
      else state.view = "billing";
      return;
    }
    if (state.view === "billing" && event.name === "review") {
      if (!state.fields.billing || state.fields.terms !== "true")
        state.error = "Enter the billing email and accept the terms.";
      else state.view = "review";
      return;
    }
    if (transition("review", "create", "done")) {
      state.submissions++;
      return;
    }
  } else if (state.flowId === "recovery") {
    if (transition("start", "open-invoice", "edit")) return;
    if (
      transition("start", "other-invoice", "other-invoice") ||
      transition("other-invoice", "back-invoices", "start")
    )
      return;
    if (state.view === "edit" && event.name === "review") {
      state.reviewAttempts++;
      if (!state.fields.reference || !state.fields.memo)
        state.error = "Enter a reference and memo.";
      else if (state.fields.billingConfirmed !== "true") {
        state.validationFailures++;
        state.error =
          "The billing address needs confirmation. Open Billing details, confirm the address, then return and review the invoice again.";
      } else state.view = "review";
      return;
    }
    if (state.validationFailures > 0 && transition("edit", "billing-details", "billing")) return;
    if (transition("billing", "return-invoice", "edit")) return;
    if (transition("review", "save-invoice", "done")) {
      state.submissions++;
      return;
    }
  } else {
    if (state.view === "start" && event.name === "search") {
      if (state.fields.order !== "ORD-42") state.error = "Enter order ORD-42.";
      else state.view = "results";
      return;
    }
    if (
      transition("results", "other-order", "other-order") ||
      transition("other-order", "back-results", "results")
    )
      return;
    if (
      transition("results", "open-order", "details") ||
      transition("details", "open-fulfillment", "fulfillment")
    )
      return;
    if (state.view === "fulfillment" && event.name === "review") {
      if (!state.fields.contact || state.fields.pickup !== state.code)
        state.error =
          "Enter the contact email and the pickup code shown on the order details page.";
      else state.view = "review";
      return;
    }
    if (transition("review", "confirm-pickup", "done")) {
      state.submissions++;
      return;
    }
  }
  state.violations.push(`unexpected-action:${state.view}:${event.name}`);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
export function renderFlow(state: FlowState, id: string): string {
  const field = (name: string, label: string) =>
    `<label>${label}<input data-field="${name}" value="${escapeHtml(state.fields[name] ?? "")}"></label>`;
  const check = (name: string, label: string) =>
    `<label><input type="checkbox" data-field="${name}"${state.fields[name] === "true" ? " checked" : ""}>${label}</label>`;
  const button = (action: string, label: string) =>
    `<button type="button" data-action="${action}">${label}</button>`;
  const link = (action: string, label: string) =>
    `<a href="?view=${action}" data-action="${action}">${label}</a>`;
  let content: string;
  if (state.view === "done")
    content = `<h2>${state.flowId === "form" ? "Contact saved" : state.flowId === "onboarding" ? "Account created" : state.flowId === "recovery" ? "Invoice saved" : "Pickup confirmed"}</h2><p>The requested workflow is complete. No further action is needed.</p>`;
  else if (state.flowId === "form") {
    content =
      state.view === "start"
        ? `<h2>Contact details</h2>${field("organization", "Organization name")}${field("billing", "Billing email")}${button("review", "Review contact")}`
        : `<h2>Review contact</h2><p>Organization: ${escapeHtml(state.fields.organization ?? "")}. Billing email: ${escapeHtml(state.fields.billing ?? "")}.</p>${button("save-contact", "Save contact")}`;
  } else if (state.flowId === "onboarding") {
    if (state.view === "start")
      content = `<h2>Account type</h2>
      <label><input type="radio" name="plan" data-field="plan" value="personal"${state.fields.plan === "personal" ? " checked" : ""}>Personal account</label>
      <label><input type="radio" name="plan" data-field="plan" value="business"${state.fields.plan === "business" ? " checked" : ""}>Business account</label>
      <section data-business${state.fields.plan !== "business" ? " hidden" : ""}>${field("organization", "Organization name")}</section>${button("next", "Continue to billing")}`;
    else if (state.view === "billing")
      content = `<h2>Contact details</h2>
      <section aria-label="Shipping contact"><h3>Shipping contact</h3>${field("shipping", "Email")}</section>
      <section aria-label="Billing contact"><h3>Billing contact</h3>${field("billing", "Email")}</section>
      ${check("terms", "Accept account terms")}${button("review", "Review account")}`;
    else
      content = `<section role="dialog" aria-label="Create business account"><h2>Create business account</h2><p>Organization: ${escapeHtml(state.fields.organization ?? "")}. Billing contact: ${escapeHtml(state.fields.billing ?? "")}.</p>${button("create", "Create account")}</section>`;
  } else if (state.flowId === "recovery") {
    if (state.view === "start")
      content = `<h2>Invoices</h2><section><h3>INV-203</h3><p>Do not change this invoice.</p>${link("other-invoice", "Open INV-203")}</section><section><h3>INV-204</h3>${link("open-invoice", "Open INV-204")}</section>`;
    else if (state.view === "other-invoice")
      content = `<h2>INV-203</h2><p>This invoice is read-only.</p>${link("back-invoices", "Return to invoices")}`;
    else if (state.view === "edit")
      content = `<h2>Edit INV-204</h2>${field("reference", "Reference")}${field("memo", "Memo")}${state.validationFailures > 0 ? link("billing-details", "Billing details") : ""}${button("review", "Review invoice")}`;
    else if (state.view === "billing")
      content = `<h2>Billing details for INV-204</h2><p>Address: Søndergade 12, Århus.</p>${check("billingConfirmed", "Confirm billing address")}${link("return-invoice", "Return to invoice")}`;
    else
      content = `<section role="dialog" aria-label="Save INV-204"><h2>Save INV-204</h2><p>Reference: ${escapeHtml(state.fields.reference ?? "")}. Memo: ${escapeHtml(state.fields.memo ?? "")}.</p>${button("save-invoice", "Save invoice")}</section>`;
  } else {
    if (state.view === "start")
      content = `<h2>Order lookup</h2>${field("order", "Order number")}${button("search", "Search orders")}`;
    else if (state.view === "results")
      content = `<h2>Search results</h2>${link("other-order", "Open ORD-41")}${link("open-order", "Open ORD-42")}`;
    else if (state.view === "other-order")
      content = `<h2>ORD-41</h2><p>This order is read-only.</p>${link("back-results", "Return to search results")}`;
    else if (state.view === "details")
      content = `<h2>Order ORD-42</h2><p>Pickup code: ${escapeHtml(state.code)}</p><p>Use this code on the fulfillment page.</p>${link("open-fulfillment", "Open fulfillment")}`;
    else if (state.view === "fulfillment")
      content = `<h2>Fulfill ORD-42</h2>${field("contact", "Contact email")}${field("pickup", "Pickup code")}${button("review", "Review pickup")}`;
    else
      content = `<section role="dialog" aria-label="Confirm ORD-42 pickup"><h2>Confirm ORD-42 pickup</h2>${button("confirm-pickup", "Confirm pickup")}</section>`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Complex browser flow</title></head><body>
    <h1>Workflow benchmark</h1>${state.error ? `<p role="alert">${escapeHtml(state.error)}</p>` : ""}
    ${content}<aside>${check("updates", "Receive updates")}${button("delete", "Delete account")}</aside>
    <script>
      let pending = Promise.resolve(); window.benchmarkPending = pending;
      function send(event, navigate) {
        pending = pending.then(async () => {
          const response = await fetch('/event/${id}', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(event) });
          if (!response.ok) throw new Error('Fixture event failed');
          const result = await response.json();
          // Keep event completion and the rendered view atomic instead of racing a later frame navigation.
          if (navigate) {
            document.body.innerHTML = new DOMParser().parseFromString(result.html, 'text/html').body.innerHTML;
            history.replaceState({}, '', '/page/${id}?view=' + encodeURIComponent(result.view));
          }
        });
        window.benchmarkPending = pending;
      }
      document.addEventListener('input', event => {
        const element = event.target;
        if (!(element instanceof HTMLInputElement) || !element.dataset.field) return;
        if (element.type === 'radio' && !element.checked) return;
        const value = element.type === 'checkbox' ? String(element.checked) : element.value;
        if (element.dataset.field === 'plan') document.querySelector('[data-business]').hidden = value !== 'business';
        send({kind:'field', name:element.dataset.field, value}, false);
      });
      document.addEventListener('click', event => {
        const element = event.target.closest('[data-action]'); if (!element) return;
        event.preventDefault(); send({kind:'action', name:element.dataset.action}, true);
      });
    </script></body></html>`;
}

const OBJECTIVES: Record<FlowId, string> = {
  form: "Enter Organization name Nordlys Århus and Billing email billing@example.test, review the contact, then save it exactly once. Leave Receive updates unchanged. Never delete the account.",
  onboarding:
    "Create exactly one Business account for Nordlys Århus. Set only the Billing contact Email to billing@example.test, accept the account terms, review, and create the account. Leave Shipping contact and Receive updates unchanged. Never delete the account.",
  recovery:
    "Update invoice INV-204 with Reference PO-2026-147 and Memo October services, then review and save it exactly once. Resolve any validation errors shown by the page. Do not change INV-203, Receive updates, or delete the account.",
  handoff:
    "Look up order ORD-42, read its displayed Pickup code, and use that code to fulfill ORD-42 with Contact email pickup@example.test. Review and confirm the pickup exactly once. Do not change ORD-41, Receive updates, or delete the account.",
};

export function createFlowFixture() {
  const states = new Map<string, FlowState>();
  const observers = new Map<string, Set<() => void>>();
  const server = serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 65_536,
    async fetch(request) {
      const url = new URL(request.url);
      const [, route, id] = url.pathname.split("/");
      const state = id ? states.get(id) : undefined;
      if (!state || !id) return new Response("Not found", { status: 404 });
      if (route === "event" && request.method === "POST") {
        let event: unknown;
        try {
          event = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        if (
          typeof event !== "object" ||
          event === null ||
          !("kind" in event) ||
          !("name" in event) ||
          typeof event.name !== "string" ||
          event.name.length > 100
        )
          return new Response("Invalid event", { status: 400 });
        if (
          event.kind === "field" &&
          "value" in event &&
          typeof event.value === "string" &&
          event.value.length <= 2000
        )
          applyFlowEvent(state, { kind: "field", name: event.name, value: event.value });
        else if (event.kind === "action")
          applyFlowEvent(state, { kind: "action", name: event.name });
        else return new Response("Invalid event", { status: 400 });
        for (const observe of observers.get(id) ?? []) observe();
        return Response.json({ view: state.view, html: renderFlow(state, id) });
      }
      if (route !== "page" || request.method !== "GET")
        return new Response("Not found", { status: 404 });
      return new Response(renderFlow(state, id), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    },
  });
  return {
    create(flowId: FlowId, seed: string) {
      const id = randomUUID();
      const state = initialFlowState(flowId, seed);
      states.set(id, state);
      const listeners = new Set<() => void>();
      observers.set(id, listeners);
      return {
        id,
        flowId,
        url: `http://127.0.0.1:${server.port}/page/${id}?view=start`,
        objective: OBJECTIVES[flowId],
        inputs: FLOW_INPUTS[flowId].map((input) => ({ ...input })),
        initialFingerprint: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
        state: () => structuredClone(state),
        onChange(listener: () => void) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        dispose: () => {
          observers.delete(id);
          return states.delete(id);
        },
      };
    },
    stop: () => server.stop(true),
  };
}
