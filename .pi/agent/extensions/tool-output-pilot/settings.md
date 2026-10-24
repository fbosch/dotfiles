# Bash output previews

This extension saves complete eligible Bash text locally and replaces the chat-facing result with deterministic excerpts. It does not call a classifier. The directory retains its original `tool-output-pilot` name.

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

The preview retains the first four and last six lines, plus lines with common diagnostic or outcome markers and one adjacent line on each side. Markers include errors, warnings, failures, constraints, revisions, final results, summaries, skipped work, timeouts, incompatibility, and prohibitions. Excerpts remain in source order and preserve their original line contents. Explicit omission markers identify every gap. Preview labels are not file anchors and must not be used for edits.

These are incomplete excerpts, not a semantic summary. Relevant evidence without a recognized marker can be omitted. Retrieve the full output when the question depends on omitted evidence; a preview cannot establish that no other findings exist.

The preview, including retrieval instructions, must fit within 6,000 UTF-8 bytes and save at least 25% of the original text bytes. If required excerpts exceed that budget, the original result remains unchanged. This measures text bytes, not tokens or end-to-end latency.

## Eligibility and preservation

Only successful top-level `bash` results are eligible. The extension requires one complete text block matching native structured output, explicit zero exit status, and `truncated: false`. It skips nested calls, failures, media, other tools, existing full-output-file references, and incomplete captures. Read/search/edit results and their source anchors are never shortened. Codemode's nested calls receive their original results.

Eligible text is 8,000 to 128,000 UTF-8 bytes, with no line longer than 2,000 bytes. Binary/control-character output, ANSI escape sequences, invalid Unicode round trips, and suspicious secret-like patterns are excluded. This heuristic cannot guarantee that an output contains no sensitive information.

The full native `structuredContent` object, including output and status fields, is preserved explicitly. Only model-facing text changes. Details, usage, and error status remain unchanged. Programmatic consumers keep the full data; they do not gain context savings from this extension. Other result hooks run in load order and may change these fields afterward.

## Storage and failure behavior

Before publishing a preview, the extension writes the exact captured text to `output.txt` inside a private random `pi-tool-output-*` directory under the system temporary directory. The directory uses mode `0700`; files use mode `0600`. `report.json` records the artifact path, byte counts, selected line ranges, and local processing time. A `tool-output-preview` session entry stores the same metadata without duplicating the output.

This preserves the captured text, not original process bytes lost before Pi decoded them. It never reads a full-output path supplied by another tool. Artifact paths are generated independently of commands and tool IDs. No extra copy is sent to a classifier or another external service.

Up to 8 MiB of captured text can be reserved between session lifecycle resets. Reservations include failed attempts and are made before asynchronous writes, so parallel calls share the limit. Metadata and filesystem overhead are additional. Reloading or replacing the extension resets the in-memory budget. Existing artifacts are not deleted automatically and can accumulate across sessions.

Storage errors, disabled settings, cancellation, and session or directory changes leave the original result unchanged. A failed attempt may leave private partial artifacts. Retrieval needs no in-memory registry and works after reload while the artifact exists. Temporary-directory cleanup or manual deletion removes retrieval access; artifacts are not durable backups. Disabling previews does not delete previous artifacts.
