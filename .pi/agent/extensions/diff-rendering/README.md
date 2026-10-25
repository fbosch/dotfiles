# Diff rendering

Render Git diffs and edit previews in-process with Shiki. The extension has no
Delta runtime dependency.

Use `/diff` for unstaged working-tree changes. The agent's `git_diff` tool also
supports staged changes, revisions, path filters, and inline or side-by-side
layouts.

Configure the extension in `~/.pi/agent/settings.json`:

```json
{
  "diffRendering": {
    "editPreviews": true,
    "syntaxTheme": "zenwritten_dark"
  }
}
```

`zenwritten_dark` is the default. The local Shiki theme matches Pi's Zenwritten
palette, with separate backgrounds for changed lines and changed words.
`syntaxTheme` also accepts bundled Shiki theme names.

The presentation follows Archimedes: colored edge gutters, horizontal rules, and
hatched alignment gaps. Split view starts at 150 available columns and requires
60 code columns per side; wrapping-heavy diffs fall back to inline. Real blank
lines and wrapped source continuations are not hatched. The redundant `old`/`new`
headings are omitted.
The extension prewarms common grammars at session start, loads other grammars on
demand, and caches tokenized source with entry and byte limits. Unknown languages
and oversized inputs render as plain text with a warning. Output remains bounded;
truncated diffs link to a full plain-text artifact.

Hashline tools retain their execution and anchor behavior. Display renderers hide
anchors without changing the model-facing results.

Run `/reload` after changing the extension.
