// stretchtext: cc-stretch (https://github.com/pro-vi/cc-stretch) for Pi.
// Replies carry `{{short|long}}` stretches. Pi draws each closed one as its underlined short form;
// in fullscreen a click on it opens it in place and a click on « closes it. alt+o puts a letter
// over each closed stretch and typing it opens it; alt+c does the same over each « to close.

import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
} from "@earendil-works/pi-coding-agent";

import { LinkTable } from "./src/links";
import { Store } from "./src/monad";
import { onMarkdownClick } from "./src/mouse";
import { parse, stretches } from "./src/parse";
import { GUIDE } from "./src/prompt";
import { draw } from "./src/render";
import { Screen } from "./src/screen";
import type { Mode } from "./src/state";
import {
  initialState,
  pickLetter,
  remember,
  restoreReplies,
  startLettering,
  takeReadNote,
  toggle,
} from "./src/state";
import type { Target } from "./src/target";

function textBlocks(message: MessageEndEvent["message"]): readonly string[] {
  if (message.role !== "assistant") return [];
  // Pi renders each text block separately and trims it before the Markdown transformer runs.
  return message.content.flatMap((block) => (block.type === "text" ? [block.text.trim()] : []));
}

export default function stretchtext(pi: ExtensionAPI) {
  const screen = new Screen();
  const store = new Store(initialState, () => screen.redraw());
  const links = new LinkTable();

  function restoreBranch(ctx: ExtensionContext) {
    const replies = ctx.sessionManager
      .getBranch()
      .flatMap((entry) => (entry.type === "message" ? [textBlocks(entry.message)] : []));
    store.run(restoreReplies(replies));
  }

  function toggleStretch(target: Target) {
    store.run(toggle(target));
  }

  function askForLetter(ctx: ExtensionContext, mode: Mode) {
    if (ctx.mode !== "tui") return;
    if (!store.run(startLettering(mode))) {
      ctx.ui.notify(`stretchtext: nothing to ${mode}`, "info");
      return;
    }
    void ctx.ui.custom<void>((tui, theme, _keys, done) => {
      screen.attach(tui, theme);
      return {
        render: (width: number) => [
          theme.fg(
            "dim",
            `stretch: type a letter to ${mode} (any other key cancels)`.slice(0, width),
          ),
        ],
        invalidate: () => {},
        handleInput: (key: string) => {
          store.run(pickLetter(key)).forEach(toggleStretch);
          done();
        },
      };
    });
  }

  onMarkdownClick((line, x) => links.at(line, x).map((target) => () => toggleStretch(target)));

  pi.registerMarkdownTransformer((markdown, { messageType }) => {
    if (messageType !== "assistant" || !markdown.includes("{{")) return markdown;
    const segments = parse(markdown);
    if (stretches(segments).length === 0) return markdown;
    return draw(store.current, { links, theme: screen.theme }, markdown, segments);
  });

  pi.on("message_end", (event) => {
    store.run(remember(textBlocks(event.message)));
  });

  pi.on("session_tree", (_event, ctx) => restoreBranch(ctx));

  pi.on("before_agent_start", (event) => {
    const sections = event.systemPromptOptions.sections;
    sections.stretchtext = GUIDE;
    store.run(takeReadNote()).match({
      some: (note) => {
        sections.stretchtext_read = note;
      },
      none: () => {
        delete sections.stretchtext_read;
      },
    });
  });

  // An empty widget below the editor draws nothing and takes no row; it is only how an extension gets the TUI.
  pi.on("session_start", (_event, ctx) => {
    restoreBranch(ctx);
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget(
      "stretchtext",
      (tui, theme) => {
        screen.attach(tui, theme);
        return { render: () => [], invalidate: () => {} };
      },
      { placement: "belowEditor" },
    );
  });

  pi.registerShortcut("alt+o", {
    description: "stretchtext: letters over closed stretches, to open one",
    handler: (ctx) => askForLetter(ctx, "open"),
  });
  pi.registerShortcut("alt+c", {
    description: "stretchtext: letters over open stretches, to close one",
    handler: (ctx) => askForLetter(ctx, "close"),
  });
}
