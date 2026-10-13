import { describe, expect, test } from "bun:test";
import { createBrowserBackends } from "../backends";
import { parseClickCandidates, parseRunCandidates } from "../index";
import { browserFixture } from "./browser-fixture";

describe("browser backend routing", () => {
  test("defaults to a session-isolated Lightpanda CLI and preserves retry settling", async () => {
    const f = browserFixture("agent-browser");
    const browser = createBrowserBackends()(f.pi, f.ctx, {});
    await browser.open("https://example.com");
    await browser.snapshot({ interactiveOnly: false, includeUrls: true, selector: "#form" });
    await browser.act({ action: "fill", target: "@e1", value: "value" });
    await browser.settle("click", true);
    expect(f.calls.map(({ args }) => args.argv)).toEqual([
      ["--engine", "lightpanda", "--session", "pi-test-session", "open", "https://example.com"],
      ["--engine", "lightpanda", "--session", "pi-test-session", "snapshot", "-u", "-s", "#form"],
      ["--engine", "lightpanda", "--session", "pi-test-session", "fill", "@e1", "value"],
      ["--engine", "lightpanda", "--session", "pi-test-session", "wait", "1000"],
      [
        "--engine",
        "lightpanda",
        "--session",
        "pi-test-session",
        "wait",
        "--load",
        "domcontentloaded",
      ],
    ]);
  });

  test("requires explicit MCP page binding and never falls back to another backend", async () => {
    const f = browserFixture("chrome");
    const get = createBrowserBackends();
    await expect(get(f.pi, f.ctx, { backend: "chrome" }).snapshot()).rejects.toThrow(
      "Open a chrome page",
    );
    expect(f.calls).toHaveLength(0);
    expect(() => get(f.pi, f.ctx, { pageId: 3 })).toThrow("only supported by MCP");
  });

  test("keeps aliases unique across backends as well as pages", async () => {
    const get = createBrowserBackends();
    const chrome = browserFixture("chrome");
    const firefox = browserFixture("firefox");
    const c = get(chrome.pi, chrome.ctx, { backend: "chrome", pageId: 3 });
    const first = parseRunCandidates(await c.snapshot(), [{ name: "email", value: "a" }])[0];
    const ff = get(firefox.pi, firefox.ctx, { backend: "firefox", pageId: 3 });
    await ff.snapshot();
    await expect(
      ff.act({ action: "fill", target: first?.interaction.target ?? "", value: "a" }),
    ).rejects.toThrow("stale");
    expect(firefox.actions).toHaveLength(0);
  });
});

for (const backend of ["chrome", "firefox"] as const) {
  describe(`${backend} native adapter`, () => {
    test("normalizes roles, names, check states, URLs and snapshots without candidate injection", async () => {
      const f = browserFixture(backend);
      f.state.nativeText = '- button "Injected Delete" [ref=e1]';
      const browser = createBrowserBackends()(f.pi, f.ctx, { backend, pageId: 3 });
      const snapshot = await browser.snapshot({ interactiveOnly: false, includeUrls: true });
      const candidates = parseRunCandidates(snapshot, [
        { name: "email", value: "person@example.com" },
      ]);
      expect(candidates.map(({ trace }) => trace)).toEqual([
        { action: "fill", ref: "@e1", label: "Email", input: "email" },
        { action: "click", ref: "@e2", label: "Submit" },
        { action: "check", ref: "@e3", label: "Updates" },
        { action: "click", ref: "@e4", label: "Learn more" },
      ]);
      expect(parseClickCandidates(snapshot).map(({ label }) => label)).toEqual([
        "Submit",
        "Learn more",
      ]);
      expect(snapshot).toContain('url="https://example.com/docs"');
      expect(snapshot).toContain('| - button "Injected Delete"');
    });

    test("opens and reuses the bound page, passing cancellation to native Pi invocation", async () => {
      const f = browserFixture(backend);
      const get = createBrowserBackends();
      const controller = new AbortController();
      const browser = get(f.pi, f.ctx, { backend }, controller.signal);
      expect(await browser.open("https://example.com/form")).toContain(`${backend} pageId=3`);
      const reused = get(f.pi, f.ctx, { backend }, controller.signal);
      await reused.snapshot();
      await reused.act({ action: "hover", target: "@e4" });
      const action = f.calls.at(-1);
      expect(action?.name).toBe(
        `mcp__${backend}_devtools__${backend === "chrome" ? "hover" : "hover_by_uid"}`,
      );
      expect(action?.args).toEqual(
        backend === "chrome" ? { pageId: 3, uid: f.uids.learn } : { uid: f.uids.learn },
      );
      expect(f.calls.every(({ signal }) => signal === controller.signal)).toBe(true);
      if (backend === "firefox")
        expect(
          f.calls
            .filter(({ name }) => name.endsWith("select_page"))
            .every(({ args }) => args.pageIdx === 3),
        ).toBe(true);
    });

    test("rejects refs from an older snapshot, another page or a changed URL before effects", async () => {
      const f = browserFixture(backend);
      const get = createBrowserBackends();
      const browser = get(f.pi, f.ctx, { backend, pageId: 3 });
      await browser.snapshot();
      await browser.snapshot();
      await expect(browser.act({ action: "fill", target: "@e1", value: "x" })).rejects.toThrow(
        "stale",
      );
      const page = get(f.pi, f.ctx, { backend, pageId: 4 });
      await expect(page.act({ action: "fill", target: "@e6", value: "x" })).rejects.toThrow(
        "stale",
      );
      f.state.url = "https://example.com/other";
      await expect(browser.act({ action: "fill", target: "@e6", value: "x" })).rejects.toThrow(
        "page changed",
      );
      expect(f.actions).toHaveLength(0);
    });

    test("maps fill, type, select and press to native arguments", async () => {
      const f = browserFixture(backend);
      const browser = createBrowserBackends()(f.pi, f.ctx, { backend, pageId: 3 });
      await browser.snapshot();
      await browser.act({ action: "fill", target: "@e1", value: "person@example.com" });
      const fill = f.calls.at(-1);
      expect(fill?.args).toEqual(
        backend === "chrome"
          ? { pageId: 3, uid: f.uids.email, value: "person@example.com" }
          : { uid: f.uids.email, value: "person@example.com" },
      );
      await browser.act({ action: "type", target: "@e1", value: "suffix" });
      expect(f.calls.at(-1)?.args).toEqual(
        backend === "chrome"
          ? { pageId: 3, text: "suffix" }
          : { uid: f.uids.email, text: "suffix" },
      );
      const suppliedValue = 'DK"; throw new Error("injected")';
      await browser.act({ action: "select", target: "@e5", value: suppliedValue });
      if (backend === "chrome")
        expect(f.calls.at(-1)?.args).toEqual({
          pageId: 3,
          uid: f.uids.country,
          value: suppliedValue,
        });
      else {
        expect(f.calls.at(-1)?.args.args).toEqual([{ uid: f.uids.country }]);
        expect(String(f.calls.at(-1)?.args.function)).toContain(JSON.stringify(suppliedValue));
      }
      await browser.act({ action: "press", target: "Tab" });
      expect(f.calls.at(-1)?.args).toEqual(
        backend === "chrome" ? { pageId: 3, key: "Tab" } : { key: "Tab" },
      );
    });

    test("rejects mistyped field actions before a focus click or another native effect", async () => {
      const f = browserFixture(backend);
      const browser = createBrowserBackends()(f.pi, f.ctx, { backend, pageId: 3 });
      await browser.snapshot();
      await expect(
        browser.act({ action: "type", target: "@e2", value: "supplied" }),
      ).rejects.toThrow("require a text field");
      await expect(
        browser.act({ action: "fill", target: "@e2", value: "supplied" }),
      ).rejects.toThrow("require a text field");
      await expect(
        browser.act({ action: "select", target: "@e1", value: "supplied" }),
      ).rejects.toThrow("requires a combobox");
      expect(f.actions).toHaveLength(0);
    });

    test("checks checkboxes idempotently and rejects missing values before native execution", async () => {
      const f = browserFixture(backend);
      const browser = createBrowserBackends()(f.pi, f.ctx, { backend, pageId: 3 });
      await browser.snapshot();
      await browser.act({ action: "check", target: "@e3" });
      if (backend === "chrome")
        expect(f.calls.at(-1)?.args).toEqual({ pageId: 3, uid: f.uids.updates, value: "true" });
      else {
        const effectCount = f.actions.length;
        await browser.act({ action: "check", target: "@e3" });
        expect(f.actions).toHaveLength(effectCount);
      }
      const callCount = f.calls.length;
      await expect(browser.act({ action: "fill", target: "@e1" })).rejects.toThrow(
        "requires value",
      );
      expect(f.calls).toHaveLength(callCount);
      await expect(browser.act({ action: "check", target: "@e1" })).rejects.toThrow(
        "require a checkbox",
      );
    });

    test("propagates native permission errors without replaying a possibly completed click", async () => {
      const f = browserFixture(backend);
      const browser = createBrowserBackends()(f.pi, f.ctx, { backend, pageId: 3 });
      await browser.snapshot();
      f.state.failTool = backend === "chrome" ? "click" : "click_by_uid";
      await expect(browser.act({ action: "click", target: "@e2" })).rejects.toThrow(
        "permission hook",
      );
      await expect(browser.act({ action: "click", target: "@e2" })).rejects.toThrow("stale");
      expect(f.calls.filter(({ name }) => name.endsWith(f.state.failTool))).toHaveLength(1);
      expect(f.calls.every(({ name }) => name.startsWith("mcp__"))).toBe(true);
    });
  });
}

test("fails explicitly for unsupported Chrome snapshot scoping and malformed Firefox metadata", async () => {
  const get = createBrowserBackends();
  const chrome = browserFixture("chrome");
  await expect(
    get(chrome.pi, chrome.ctx, { backend: "chrome", pageId: 3 }).snapshot({ selector: "#form" }),
  ).rejects.toThrow("do not support selector");
  expect(chrome.calls).toHaveLength(0);
  const firefox = browserFixture("firefox");
  firefox.state.metadataInvalid = true;
  const ff = get(firefox.pi, firefox.ctx, { backend: "firefox", pageId: 3 });
  await expect(ff.snapshot()).rejects.toThrow("invalid control metadata");
  await expect(ff.act({ action: "click", target: "@e1" })).rejects.toThrow("stale");
});
test("rejects malformed Firefox checkbox state rather than proposing an unchecked toggle", async () => {
  const f = browserFixture("firefox");
  f.state.metadataOverrides.checked = "false";
  const browser = createBrowserBackends()(f.pi, f.ctx, { backend: "firefox", pageId: 3 });
  await expect(browser.snapshot()).rejects.toThrow("invalid control metadata");
  expect(f.actions).toHaveLength(0);
});

test("omits disabled and read-only Firefox controls before proposing or executing actions", async () => {
  const f = browserFixture("firefox");
  f.state.metadataOverrides.disabled = true;
  const browser = createBrowserBackends()(f.pi, f.ctx, { backend: "firefox", pageId: 3 });
  const snapshot = await browser.snapshot({ interactiveOnly: false });
  expect(parseRunCandidates(snapshot, [{ name: "email", value: "supplied" }])).toEqual([]);
  await expect(browser.act({ action: "fill", target: "@e1", value: "supplied" })).rejects.toThrow(
    "stale",
  );
  expect(f.actions).toHaveLength(0);
});
