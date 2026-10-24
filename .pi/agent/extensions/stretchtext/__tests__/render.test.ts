import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import {
  getMarkdownTheme,
  initTheme,
  loadThemeFromPath,
} from "@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { Markdown, visibleWidth } from "@earendil-works/pi-tui";
import { LinkTable } from "../src/links";
import { Option, Store } from "../src/monad";
import { parse, stretches } from "../src/parse";
import { draw } from "../src/render";
import {
  initialState,
  pickLetter,
  remember,
  startLettering,
  takeReadNote,
  toggle,
} from "../src/state";
import type { Target } from "../src/target";

initTheme("dark", false);
const theme = loadThemeFromPath(
  new URL("../../../themes/zenwritten-dark.json", import.meta.url).pathname,
);
const CODE = String.fromCharCode(96);
const TABLE =
  "| Extension | Own | Shared |\n|---|---:|---:|\n| auth-profiles | 166.3 | 55.0 |\n| chart | 75.8 | 0.0 |";

function opened(reply: string) {
  const store = new Store(initialState, () => {});
  const links = new LinkTable();
  store.run(remember([reply]));
  const stretch = stretches(parse(reply))[0];
  if (!stretch) throw new Error("Fixture has no stretch");
  const target: Target = { reply, stretch };
  store.run(toggle(target));
  const source = () =>
    draw(store.current, { links, theme: Option.some(theme) }, reply, parse(reply));
  return { store, links, target, source };
}

function render(source: string, width = 80) {
  return new Markdown(source, 0, 0, getMarkdownTheme()).render(width);
}

function tableRows(source: string, width: number) {
  return render(source, width)
    .map(stripVTControlCharacters)
    .filter((line) => /^[┌│├└]/u.test(line));
}

test("expanded tables render as columns with a separate clickable collapse control", () => {
  const { links, target, source } = opened(
    "{{Full size breakdown.|Full size breakdown.\n\n" + TABLE + "}}",
  );
  const lines = render(source());
  const plain = lines.map(stripVTControlCharacters);
  expect(plain.some((line) => line.startsWith("┌"))).toBe(true);
  expect(plain.some((line) => line.includes("│ auth-profiles"))).toBe(true);
  const closeRow = plain.findIndex((line) => line.trim() === "[« Collapse]");
  expect(closeRow).toBeGreaterThan(plain.findIndex((line) => line.startsWith("└")));
  expect(
    links.at(lines[closeRow] ?? "", (plain[closeRow] ?? "").indexOf("«")).getOrElse(undefined),
  ).toEqual(target);
  expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
});

const tables = [
  TABLE,
  "Name | Own | Shared\n:--- | ---: | :---:\nchart | 75.8 | 0.0",
  "|Name|Own|\n|---|---:|\n|chart|75.8|",
  "| Name | Detail |\n|---|---|\n| **chart** | " +
    CODE +
    "Own \\| shared" +
    CODE +
    " [docs](https://example.com) |",
  "| Navn | Beskrivelse |\n|---|---|\n| æøå | 漢字 and a long description that wraps |",
  "| Name | Own |\n|---|---:|\n" +
    Array.from({ length: 45 }, (_, i) => "| extension-" + i + " | " + i + ".5 |").join("\n"),
];

for (const [index, table] of tables.entries()) {
  test.each([24, 40, 100])("table " + index + " matches native Markdown at width %i", (width) => {
    const { source } = opened("{{Breakdown.|Breakdown.\n\n" + table + "}}");
    const expected = tableRows(table, width);
    expect(expected.some((line) => line.startsWith("┌"))).toBe(true);
    expect(tableRows(source(), width)).toEqual(expected);
    expect(render(source(), width).every((line) => visibleWidth(line) <= width)).toBe(true);
  });
}

test("table cells, collapse letters, and following paragraphs stay separate", () => {
  const { store, links, target, source } = opened(
    "{{Breakdown.|Breakdown.\n\n" + TABLE + "}}\n\nFollowing paragraph.",
  );
  expect(store.run(startLettering("close"))).toBe(true);
  const lines = render(source());
  const plain = lines.map(stripVTControlCharacters);
  const closeRow = plain.findIndex((line) => line.trim() === "a[« Collapse]");
  expect(closeRow).toBeGreaterThan(plain.findIndex((line) => line.startsWith("└")));
  expect(plain.some((line) => line.includes("Following paragraph."))).toBe(true);
  expect(
    links.at(lines[closeRow] ?? "", (plain[closeRow] ?? "").indexOf("«")).getOrElse(undefined),
  ).toEqual(target);
  expect(store.run(pickLetter("a")).getOrElse(undefined)).toEqual(target);
});

test("a table can close and reopen through the same stretch target", () => {
  const { store, target, source } = opened("{{Breakdown.|Breakdown.\n\n" + TABLE + "}}");
  expect(store.run(toggle(target))).toBe(false);
  expect(stripVTControlCharacters(source())).toBe("Breakdown.");
  expect(store.run(toggle(target))).toBe(true);
  expect(tableRows(source(), 80)).toEqual(tableRows(TABLE, 80));
  expect(store.run(takeReadNote()).getOrElse("")).toContain('reader opened "Breakdown."');
});

test("nested table stretches remain independently openable", () => {
  const reply = "{{Overview.|Overview. {{Breakdown.|Breakdown.\n\n" + TABLE + "}}}}";
  const { store, links, source } = opened(reply);
  const inner = stretches(parse(reply))[1];
  if (!inner) throw new Error("Fixture has no nested stretch");
  const target: Target = { reply, stretch: inner };
  store.run(toggle(target));
  expect(tableRows(source(), 80)).toEqual(tableRows(TABLE, 80));
  store.run(toggle(target));
  const line = render(source()).find((line) =>
    stripVTControlCharacters(line).includes("Breakdown."),
  );
  if (!line) throw new Error("Nested short form is missing");
  const column = stripVTControlCharacters(line).indexOf("Breakdown.");
  expect(links.at(line, column).getOrElse(undefined)).toEqual(target);
});

test("inline prose switches immediately between its full and short forms", () => {
  const { store, target, source } = opened("{{Build fails.|The Build now fails.}}");
  expect(stripVTControlCharacters(source())).toBe("The Build now fails. [« Collapse]");
  expect(source()).toContain(theme.fg("warning", "The"));
  expect(store.run(toggle(target))).toBe(false);
  expect(stripVTControlCharacters(source())).toBe("Build fails.");
  expect(store.run(toggle(target))).toBe(true);
  expect(stripVTControlCharacters(source())).toBe("The Build now fails. [« Collapse]");
});

test("fenced code in a multiline expansion keeps literal stretch syntax", () => {
  const block =
    "Example.\n\n" + CODE.repeat(3) + "text\n{{literal|not a stretch}}\n" + CODE.repeat(3) + "\n";
  const { source } = opened("{{Example.|" + block + "}}");
  expect(source().includes(block)).toBe(true);
  const plain = render(source()).map(stripVTControlCharacters);
  expect(plain.some((line) => line.includes("{{literal|not a stretch}}"))).toBe(true);
  expect(plain.some((line) => line.trim() === "[« Collapse]")).toBe(true);
});

test("collapse button is labelled, bold, and high-contrast", () => {
  const { source } = opened("{{Summary.|Summary extra.}}");
  const transformed = source();
  expect(stripVTControlCharacters(transformed)).toBe("Summary extra. [« Collapse]");
  expect(transformed).toContain("\x1b[1m");
  expect(transformed).toContain("\x1b[7m");
});

test.each([8, 20, 80])(
  "collapse button stays clickable across wrapped lines at width %i",
  (width) => {
    const { links, target, source } = opened("{{Summary.|Summary extra.}} After.");
    const lines = render(source(), width);
    let linkedText = "";
    for (const line of lines) {
      const plain = stripVTControlCharacters(line);
      for (let column = 0; column < visibleWidth(line); column++) {
        const hit = links.at(line, column).getOrElse(undefined);
        if (hit && hit.reply === target.reply && hit.stretch.key === target.stretch.key) {
          linkedText += plain[column] ?? "";
        }
      }
    }
    expect(linkedText.replaceAll(" ", "")).toBe("[«Collapse]");
    expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
  },
);
