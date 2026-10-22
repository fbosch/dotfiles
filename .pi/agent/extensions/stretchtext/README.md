# Stretchtext

Local fork of [MonadicMike/pi-stretchtext](https://github.com/MonadicMike/pi-stretchtext)
at [`c93b06876aefdfab99171145ef1cdf695bb5ada4`](https://github.com/MonadicMike/pi-stretchtext/commit/c93b06876aefdfab99171145ef1cdf695bb5ada4).
It renders expanded Markdown tables without corrupting their delimiters.

## Use

Pi discovers `index.ts` in its agent extensions directory. With
`PI_CODING_AGENT_DIR` pointing at this repository's `.pi/agent`, it loads directly.
For a default `~/.pi/agent` deployment, deploy the new files through Stow first.
The npm copy is removed from `.pi/agent/settings.json` so only the local fork loads.
Run `/reload` after changes.

Click an underlined short form to expand it, or the bold, high-contrast
`[« Collapse]` button to collapse it. The entire button is clickable.
Mouse interaction requires fullscreen mode. `alt+o` and `alt+c`, followed by a
displayed letter, work in either TUI mode.

## Local changes

Expansion and collapse are immediate for every stretch. Multiline expansions
render their complete Markdown without word-level ANSI colour. This keeps tables,
fenced code, and other block syntax intact. Their collapse control occupies a
separate paragraph so it cannot become a table cell. Inline expansions retain
upstream colour. Each stretch keeps its assigned colour when reopened within the session.

Click targets use Pi's grapheme-aware OSC-8 lookup, including joined emoji,
skin-tone modifiers, flags, and combining characters.

The keyboard's recent-reply window tracks the last three completed assistant
messages containing stretches. Multiple text blocks in one message share a slot;
streaming redraws do not add replies. Session startup, reload, and tree navigation
rebuild this window from the active branch, independently of rendering.

Keep the short form on one line and include blank lines around tables in long forms:

```text
{{Size breakdown.|Size breakdown.

| Extension | KiB |
|---|---:|
| chart | 75.8 |
}}
```

## Maintenance

`src/` retains the upstream parser, state, word matching, and mouse integration.
`src/render.ts` and `hasBlockContent()` in `src/parse.ts` define block rendering.
Mouse handling patches Pi's Markdown prototype and its private `cachedLines`,
so check clicks after Pi upgrades.

Regression tests live in `__tests__/` and are included in the existing
`test:pi-extensions` devenv task. For a focused run from the repository root:

```sh
cd .pi/agent && bun test extensions/stretchtext
```

Writer-prompt evaluations live in [`../../evals/stretchtext/`](../../evals/stretchtext/README.md).
They compare the frozen original guide with `src/prompt.ts` using synthetic
controls and optional hosted generation. Ordinary tests make no model requests.

MIT. Upstream copyright and cc-stretch attribution are retained in `LICENSE`.
