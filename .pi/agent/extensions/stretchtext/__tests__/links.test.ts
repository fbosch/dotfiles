import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { LinkTable } from "../src/links";
import { parse, stretches } from "../src/parse";

function fixture() {
  const reply = "{{Summary.|Summary extra.}}";
  const stretch = stretches(parse(reply))[0];
  if (!stretch) throw Error("Fixture is missing its stretch");
  return { links: new LinkTable(), target: { reply, stretch } };
}

test.each(["plain ", "漢字 ", "👩‍💻 ", "👨‍👩‍👧‍👦 ", "👍🏽 ", "🇩🇰 ", "✈️ ", "e\u0301 ", "æøå "])(
  "collapse button is clickable after %s",
  (prefix) => {
    const { links, target } = fixture();
    const label = "[« Collapse]";
    const line = prefix + links.link(target, label) + " suffix";
    const start = visibleWidth(prefix);
    for (let cell = 0; cell < visibleWidth(label); cell++) {
      expect(links.at(line, start + cell).getOrElse(undefined)).toEqual(target);
    }
    expect(links.at(line, start - 1).isSome).toBe(false);
    expect(links.at(line, start + visibleWidth(label)).isSome).toBe(false);
  },
);

test("both cells of a linked grapheme belong to the link", () => {
  const { links, target } = fixture();
  const label = "👩‍💻";
  const line = links.link(target, label) + "x";
  for (let cell = 0; cell < visibleWidth(label); cell++) {
    expect(links.at(line, cell).getOrElse(undefined)).toEqual(target);
  }
  expect(links.at(line, visibleWidth(label)).isSome).toBe(false);
});

test("a combining mark cannot claim the first unlinked cell", () => {
  const { links, target } = fixture();
  const label = "e\u0301";
  const line = links.link(target, label) + "x";
  expect(links.at(line, 0).getOrElse(undefined)).toEqual(target);
  expect(links.at(line, visibleWidth(label)).isSome).toBe(false);
});

test("ANSI styles and a neighbouring external link preserve click columns", () => {
  const { links, target } = fixture();
  const prefix = "\x1b[1m👩‍💻\x1b[22m ";
  const label = "\x1b[7m[« Collapse]\x1b[27m";
  const external = "\x1b]8;;https://example.com\x1b\\docs\x1b]8;;\x1b\\";
  const line = prefix + links.link(target, label) + external;
  const start = visibleWidth(prefix);
  expect(links.at(line, start).getOrElse(undefined)).toEqual(target);
  expect(links.at(line, start + visibleWidth(label)).isSome).toBe(false);
  expect(links.at(line, visibleWidth(line)).isSome).toBe(false);
});
