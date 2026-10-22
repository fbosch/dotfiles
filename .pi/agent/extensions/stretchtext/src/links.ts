// Each short form and « is an OSC 8 link whose address names the stretch, so a click on the drawn
// line finds it again after Markdown has wrapped it. The address has no http scheme, which Pi's
// Markdown would turn into a link of its own.

import { getOsc8LinkAtColumn } from "@earendil-works/pi-tui";

import { Option } from "./monad";
import type { Target } from "./target";
import { nameOf } from "./target";

const HREF = "stretchtext:";

/** The stretches drawn as links, each under a number its link's address carries. */
export class LinkTable {
  private readonly targets: Target[] = [];
  private readonly ids = new Map<string, number>();

  /** `text` as a link to `target`. */
  link(target: Target, text: string): string {
    const name = nameOf(target);
    const id = this.ids.get(name) ?? this.targets.push(target) - 1;
    this.ids.set(name, id);
    return `\x1b]8;;${HREF}${id}\x07${text}\x1b]8;;\x07`;
  }

  /** The stretch linked at column `x` of a drawn line. */
  at(line: string, x: number): Option<Target> {
    return Option.from(getOsc8LinkAtColumn(line, x))
      .filter((address) => address.startsWith(HREF))
      .flatMap((address) => Option.from(this.targets[Number(address.slice(HREF.length))]));
  }
}
