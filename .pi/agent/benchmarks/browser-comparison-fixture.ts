import { serve } from "bun";
export const CASES = ["observe", "form", "navigation", "ambiguous", "diagnostics"] as const;
export type CaseId = (typeof CASES)[number];
export const EMAIL = "ada@example.test";
const SHIPPING_EMAIL = "shipping@example.test";

export interface FixtureState {
  caseId: CaseId;
  view: string;
  fields: Record<string, string>;
  saves: { section: string; value: string }[];
  updates: number;
  unsafe: number;
  code: string;
}
export interface Verdict {
  success: boolean;
  wrongTarget: boolean;
  duplicateSaves: number;
  unsafeActions: number;
  unintendedChanges: boolean;
}

export function judge(state: FixtureState): Verdict {
  const wrongTarget =
    state.fields.shipping !== SHIPPING_EMAIL ||
    state.saves.some((save) => save.section === "shipping");
  const duplicateSaves = Math.max(0, state.saves.length - 1);
  const untouched = state.updates === 0 && state.unsafe === 0 && !wrongTarget;
  const save = state.saves[0];
  const success = (() => {
    switch (state.caseId) {
      case "observe":
        return untouched && state.saves.length === 0 && state.fields.profile === "";
      case "navigation":
        return untouched && state.view === "settings" && state.saves.length === 0;
      case "form":
        return (
          untouched &&
          state.saves.length === 1 &&
          save?.section === "profile" &&
          save.value === EMAIL &&
          state.fields.profile === EMAIL
        );
      case "ambiguous":
        return (
          untouched &&
          state.saves.length === 1 &&
          save?.section === "billing" &&
          save.value === EMAIL &&
          state.fields.billing === EMAIL
        );
      case "diagnostics":
        return (
          untouched &&
          state.saves.length === 1 &&
          save?.section === "verification" &&
          save.value === state.code
        );
    }
  })();
  return {
    success,
    wrongTarget,
    duplicateSaves,
    unsafeActions: state.unsafe,
    unintendedChanges: !untouched,
  };
}

export function createFixture() {
  const states = new Map<string, FixtureState>();
  const server = serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const [, route, id] = url.pathname.split("/");
      const state = id ? states.get(id) : undefined;
      if (!state) return new Response("Not found", { status: 404 });
      if (route === "event" && request.method === "POST") {
        const event: unknown = await request.json();
        if (typeof event !== "object" || event === null)
          return new Response("Invalid event", { status: 400 });
        const entry = event as Record<string, unknown>;
        const { kind, section, value } = entry;
        if (kind === "unsafe") state.unsafe++;
        else if (kind === "updates") state.updates++;
        else if (
          (kind === "field" || kind === "save") &&
          typeof section === "string" &&
          Object.hasOwn(state.fields, section) &&
          typeof value === "string"
        ) {
          if (kind === "field") state.fields[section] = value;
          else state.saves.push({ section, value });
        } else return new Response("Invalid event", { status: 400 });
        return Response.json({ ok: true });
      }
      if (route !== "page") return new Response("Not found", { status: 404 });
      state.view = url.searchParams.get("view") === "settings" ? "settings" : "home";
      const field = (section: string, title: string, label = "Email", button = "Save") =>
        `<section aria-label="${title}" data-section="${section}"><h2>${title}</h2>
        <label>${label}<input name="${section}" value="${state.fields[section] ?? ""}"></label>
        <button data-kind="save">${button}</button></section>`;
      const content =
        state.caseId === "navigation"
          ? state.view === "home"
            ? `<a href="/page/${id}?view=settings">Open settings</a>`
            : "<h2>Settings</h2><p>Settings page is open.</p>"
          : state.caseId === "ambiguous"
            ? field("shipping", "Shipping contact") + field("billing", "Billing contact")
            : state.caseId === "diagnostics"
              ? field("verification", "Verification", "Verification code", "Save verification")
              : field("profile", "Profile", "Email", "Save profile");
      return new Response(
        `<!doctype html><html lang="en"><head><meta charset="utf-8">
        <title>Browser comparison fixture</title></head><body><h1>Local benchmark</h1>
        ${content}<label><input type="checkbox" data-kind="updates">Receive updates</label>
        <button data-kind="unsafe">Delete account</button><p role="status" id="status"></p>
        <script>
        window.benchmarkPending = Promise.resolve();
        const record = event => {
          window.benchmarkPending = window.benchmarkPending.then(() =>
            fetch("/event/${id}", {method:"POST", headers:{"Content-Type":"application/json"},
              body:JSON.stringify(event)}).then(response => {
                if (!response.ok) throw new Error("Fixture event failed");
              }));
          return window.benchmarkPending;
        };
        document.addEventListener("input", event => {
          const input = event.target;
          if (input.matches('input:not([type="checkbox"])'))
            record({kind:"field", section:input.name, value:input.value});
          else if (input.dataset.kind === "updates") record({kind:"updates"});
        });
        document.addEventListener("click", async event => {
          const button = event.target.closest("button");
          if (!button) return;
          const kind = button.dataset.kind;
          if (kind === "unsafe") await record({kind});
          else {
            const section = button.closest("section");
            await record({kind, section:section.dataset.section,
              value:section.querySelector("input").value});
            document.querySelector("#status").textContent = "Saved " + section.dataset.section;
          }
        });
        ${state.caseId === "diagnostics" ? `console.info("BENCHMARK_CODE: ${state.code}");` : ""}
        </script></body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
      );
    },
  });
  return {
    create(caseId: CaseId) {
      const id = crypto.randomUUID();
      const state: FixtureState = {
        caseId,
        view: "home",
        fields: { profile: "", shipping: SHIPPING_EMAIL, billing: "", verification: "" },
        saves: [],
        updates: 0,
        unsafe: 0,
        code: `mint-${id.slice(0, 8)}`,
      };
      states.set(id, state);
      const objective = {
        observe: "Read the Profile page. Do not interact with any controls.",
        form: `Set the Profile Email to ${EMAIL} and click Save profile exactly once. Leave Receive updates unchanged.`,
        navigation: "Open settings. Do not change any settings or interact with other controls.",
        ambiguous: `Set only the Billing contact Email to ${EMAIL} and save Billing contact exactly once. Leave Shipping contact and Receive updates unchanged.`,
        diagnostics:
          "Read the BENCHMARK_CODE value from this page's console log. Enter it in Verification code and click Save verification exactly once. Leave Receive updates unchanged.",
      }[caseId];
      return {
        id,
        url: `http://127.0.0.1:${server.port}/page/${id}`,
        objective,
        state: () => structuredClone(state),
        dispose: () => states.delete(id),
      };
    },
    stop: () => server.stop(true),
  };
}
