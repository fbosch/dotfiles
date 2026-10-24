# Bash output previews

This extension saves complete eligible Bash text locally and replaces the chat-facing result with deterministic excerpts. It does not call a classifier.

## Enable for a project

1. Merge this setting into the project's `.pi/settings.json`:

   ```json
   {
     "toolOutput": {
       "enabled": true
     }
   }
   ```

2. Trust the project in Pi and run `/reload` after installing the extension. Later settings changes take effect on subsequent results.
3. To retrieve omitted output, call `read` with the absolute `Full output` path from the preview. Use `offset` and `limit` to read the indicated omitted line range. The installed hashline reader returns anchored rows and `nextOffset` for pagination.

Only a trusted project's explicit `true` enables previews. A global `toolOutput.enabled: false` vetoes all project opt-ins; a global `true` does not enable every project. Malformed settings leave output unchanged. The classifier master switch does not control this local-only extension. Command protection remains separate and unchanged.

## What the preview keeps

The preview retains every line outside sufficiently repeated progress templates, plus the first four and last six lines and adjacent context. Unknown lines, identifiers, changed observations, payload values, and diagnostics stay visible without needing a recognized keyword. Excerpts remain in source order and preserve original line contents. Collapsed ranges are labeled as repeated progress, not unexplained omitted evidence. Preview line labels are not file anchors and must not be used for edits.

Only explicit `progress`, `scan`, or `scanning` prefixes qualify. Additional prefix words must be counter labels such as `block`, `tick`, `item`, `batch`, `step`, `of`, or `total`. Templates must occur at least eight times. Matching normalizes integer counters in the prefix and trailing horizontal padding, but keeps the payload after the colon and line ending exact. Numbered counters must increase lexicographically; resets, duplicate numbered counters, and out-of-order sequences remain visible. The first and last member of each collapsible template remain visible, as do diagnostic lines.

This is repetition removal, not a semantic summary or task-relevance judgment. Questions about exact progress counters, skipped counter values, or individual repeated events may still require artifact retrieval. The extension does not infer that counters are consecutive or that every repeated event is irrelevant.

The preview, including retrieval instructions, must fit within 6,000 UTF-8 bytes and save at least 25% of the original text bytes. If required excerpts exceed that budget, the original result remains unchanged. This measures text bytes, not tokens or end-to-end latency.

## Eligibility and preservation

Only successful top-level `bash` results are eligible. The extension requires one complete text block matching native structured output, explicit zero exit status, and `truncated: false`. It skips nested calls, failures, media, other tools, existing full-output-file references, and incomplete captures. Read/search/edit results and their source anchors are never shortened. Codemode's nested calls receive their original results.

Eligible text is 8,000 to 128,000 UTF-8 bytes, with no line longer than 2,000 bytes. Binary/control-character output, ANSI escape sequences, invalid Unicode round trips, and suspicious secret-like patterns are excluded. This heuristic cannot guarantee that an output contains no sensitive information.

The full native `structuredContent` object, including output and status fields, is preserved explicitly. Only model-facing text changes. Details, usage, and error status remain unchanged. Programmatic consumers keep the full data; they do not gain context savings from this extension. Other result hooks run in load order and may change these fields afterward.

## Search an artifact

Use `tool_output_search` when the question concerns collapsed events and a literal query can locate the evidence:

```ts
{
  path: "/absolute/path/from/Full output/output.txt",
  queries: ["scan 257:", "scan 387:"],
  context: 1,
  limit: 20
}
```

Queries are literal substrings, case-sensitive unless `ignoreCase` is `true`. Up to eight queries of 256 characters are OR-matched. Counts report matching lines for each query over the entire captured artifact, even when `offset` selects a later page. They count lines, not substring occurrences. `matchingLines` counts the union of matching lines. Zero matches establishes only the absence of those literal substrings, not the absence of other relevant evidence.

Results contain verbatim excerpts, source line numbers, full-artifact counts, and `nextOffset`. A page returns at most 20 matching lines and 6,000 serialized UTF-8 bytes. Context defaults to one adjacent line, accepts zero to three, and may be reduced to fit the first match. Remaining matches require another call at `nextOffset`. `pageComplete` means all matches from the requested offset were returned; `allMatchesReturned` additionally requires starting at line one. Source line numbers are not edit anchors. Use `read` when exact file anchors or the full capture are needed.

Search accepts only paths with integrity metadata in the current session branch for the current trusted, opted-in project. The extension records each new artifact's SHA-256 and checks its bytes, size, ownership, and private permissions before returning results. It rejects changed, missing, symlinked, special, or unregistered files. It does not execute shell commands. Session and project policy are checked again before publishing results.

Reload and resume recover search access from branch entries, not an in-memory file registry. Captures created before integrity metadata was added remain accessible with `read` but cannot be searched by this tool. Disabling the project opt-in blocks search as well as new previews.

## Storage and failure behavior

Before publishing a preview, the extension writes the exact captured text to `output.txt` inside a private random `pi-tool-output-*` directory under the system temporary directory. The directory uses mode `0700`; files use mode `0600`. `report.json` records the artifact path, project directory, SHA-256, byte counts, selected line ranges, and local processing time. A `tool-output-preview` session entry stores the same metadata without duplicating the output.

This preserves the captured text, not original process bytes lost before Pi decoded them. It never reads a full-output path supplied by another tool. Artifact paths are generated independently of commands and tool IDs. No extra copy is sent to a classifier or another external service.

Up to 8 MiB of captured text can be reserved between session lifecycle resets. Reservations include failed attempts and are made before asynchronous writes, so parallel calls share the limit. Metadata and filesystem overhead are additional. Reloading or replacing the extension resets the in-memory budget. Existing artifacts are not deleted automatically and can accumulate across sessions.

Storage errors, disabled settings, cancellation, and session or directory changes leave the original result unchanged. A failed attempt may leave private partial artifacts. Retrieval needs no in-memory registry and works after reload while the artifact exists. Temporary-directory cleanup or manual deletion removes retrieval access; artifacts are not durable backups. Disabling previews does not delete previous artifacts.
