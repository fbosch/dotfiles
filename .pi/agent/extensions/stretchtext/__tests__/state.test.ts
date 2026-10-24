import { expect, test } from "bun:test";
import { loadThemeFromPath } from "@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { LinkTable } from "../src/links";
import { Option, Store } from "../src/monad";
import { parse, stretches } from "../src/parse";
import { draw } from "../src/render";
import { initialState, remember, restoreReplies, takeReadNote, toggle } from "../src/state";
import type { Target } from "../src/target";

const theme = loadThemeFromPath(
  new URL("../../../themes/zenwritten-dark.json", import.meta.url).pathname,
);

function setup(reply: string) {
  const store = new Store(initialState, () => {});
  const canvas = { links: new LinkTable(), theme: Option.some(theme) };
  const targets = stretches(parse(reply)).map((stretch): Target => ({ reply, stretch }));
  store.run(remember([reply]));
  return {
    store,
    target(index: number) {
      const target = targets[index];
      if (!target) throw new Error("Missing fixture stretch");
      return target;
    },
    view(target: Target) {
      return draw(store.current, canvas, target.reply, [target.stretch]);
    },
  };
}

test("reopened stretches retain their original colour after other stretches open", () => {
  const { store, target, view } = setup("{{First.|First added.}} {{Second.|Second added.}}");
  const first = target(0);
  const second = target(1);
  store.run(toggle(first));
  const original = view(first);
  expect(original).toContain(theme.fg("warning", "added."));
  store.run(toggle(first));
  store.run(toggle(second));
  for (let i = 0; i < 3; i++) {
    expect(store.run(toggle(first))).toBe(true);
    expect(view(first)).toBe(original);
    expect(store.run(toggle(first))).toBe(false);
  }
});

test("reopening does not consume the next newly opened stretch's palette colour", () => {
  const { store, target, view } = setup(
    "{{First.|First added.}} {{Second.|Second added.}} {{Third.|Third added.}}",
  );
  const first = target(0);
  const second = target(1);
  const third = target(2);
  store.run(toggle(first));
  store.run(toggle(first));
  store.run(toggle(second));
  store.run(toggle(first));
  store.run(toggle(third));
  expect(view(second)).toContain(theme.fg("accent", "[« Collapse]"));
  expect(view(third)).toContain(theme.fg("success", "added."));
});

test("nested stretches retain their own colours across parent and child reopenings", () => {
  const { store, target, view } = setup(
    "{{Parent.|Parent added. {{Child.|Child added.}}}} {{Other.|Other added.}}",
  );
  const parent = target(0);
  const child = target(1);
  const other = target(2);
  store.run(toggle(parent));
  store.run(toggle(child));
  const childOriginal = view(child);
  expect(childOriginal).toContain(theme.fg("accent", "added."));
  store.run(toggle(child));
  store.run(toggle(parent));
  store.run(toggle(other));
  store.run(toggle(parent));
  expect(view(parent)).toContain(theme.fg("warning", "added."));
  store.run(toggle(child));
  expect(view(child)).toBe(childOriginal);
});

test("reopening a stretch still reports it as read", () => {
  const { store, target } = setup("{{Details.|Details added.}}");
  const details = target(0);
  store.run(toggle(details));
  store.run(takeReadNote());
  store.run(toggle(details));
  store.run(toggle(details));
  expect(store.run(takeReadNote()).getOrElse("")).toContain('reader opened "Details."');
});

test("table collapse controls retain their assigned colour when reopened", () => {
  const { store, target, view } = setup(
    "{{Table.|Table.\n\n| Name | Size |\n|---|---:|\n| chart | 75.8 |}} {{Other.|Other added.}}",
  );
  const table = target(0);
  store.run(toggle(table));
  const original = view(table);
  store.run(toggle(table));
  store.run(toggle(target(1)));
  store.run(toggle(table));
  expect(view(table)).toBe(original);
});

test("branch reconstruction preserves a stretch's assigned colour when reopened", () => {
  const reply = "{{First.|First added.}} {{Second.|Second added.}}";
  const { store, target, view } = setup(reply);
  store.run(toggle(target(0)));
  store.run(toggle(target(1)));
  const original = view(target(1));
  expect(original).toContain(theme.fg("accent", "[« Collapse]"));
  store.run(toggle(target(1)));
  store.run(restoreReplies([["{{Other.|Other detail.}}"]]));
  store.run(restoreReplies([[reply]]));
  store.run(toggle(target(1)));
  expect(view(target(1))).toBe(original);
});

test("identical completed messages still occupy distinct recent-reply slots", () => {
  const reply = "{{Details.|Details added.}}";
  const { store } = setup(reply);
  store.run(remember([reply]));
  expect(store.current.replies).toEqual([[reply], [reply]]);
});
