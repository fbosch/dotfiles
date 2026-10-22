// How a reply is drawn for a given state: each closed stretch as its underlined short form, each open
// one as its long form with a labelled collapse button. Both are links a click finds again.

import type { Theme } from "@earendil-works/pi-coding-agent";
import { paintExpansion } from "./grow";
import type { LinkTable } from "./links";
import { Option } from "./monad";
import { closerPaint, wordsPaint } from "./palette";
import type { Segment } from "./parse";
import { drawnAs, hasBlockContent } from "./parse";
import type { Mode, StretchState } from "./state";
import type { Target } from "./target";
import { nameOf } from "./target";

const underline = (text: string) => `\x1b[4m${text}\x1b[24m`;
const reverse = (text: string) => `\x1b[7m${text}\x1b[27m`;
const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;

/** What a reply is drawn with besides its state: the links a click finds, and Pi's theme for colour. */
export type Canvas = { links: LinkTable; theme: Option<Theme> };

export function draw(
  state: StretchState,
  canvas: Canvas,
  reply: string,
  segments: readonly Segment[],
): string {
  return segments
    .map((segment) => {
      if (typeof segment === "string") return segment;
      const mode = drawnAs(segment);
      if (mode === "text") return segment.short;
      if (mode === "open") return draw(state, canvas, reply, segment.long.getOrElse([]));
      return drawLink(state, canvas, { reply, stretch: segment });
    })
    .join("");
}

function drawLink(state: StretchState, { links, theme }: Canvas, target: Target): string {
  const name = nameOf(target);
  const hue = state.open.get(name);
  if (hue === undefined)
    return letter(state, name, "open") + links.link(target, underline(target.stretch.short));

  const button = bold(reverse(closerPaint(theme, hue)("[« Collapse]")));
  const closer = letter(state, name, "close") + links.link(target, button);
  if (hasBlockContent(target.stretch)) {
    // ANSI paint breaks table delimiters, and an inline closer becomes another cell in the last row.
    const long = draw(state, { links, theme }, target.reply, target.stretch.long.getOrElse([]));
    return `${long}\n\n${closer}\n\n`;
  }

  const long = paintExpansion(
    target.stretch.short,
    target.stretch.long.getOrElse([]),
    (nested) => draw(state, { links, theme }, target.reply, [nested]),
    wordsPaint(theme, hue, state.newest.is(name)),
  );
  return `${long} ${closer}`;
}

/** The letter over a stretch while letters for `mode` show, or "". */
function letter(state: StretchState, name: string, mode: Mode): string {
  return state.lettering
    .filter((lettering) => lettering.mode === mode)
    .flatMap((lettering) => Option.from(lettering.byName.get(name)))
    .match({ some: reverse, none: () => "" });
}
