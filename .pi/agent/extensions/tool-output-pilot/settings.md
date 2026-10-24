# Tool-output shadow pilot

The pilot ranks blocks of approved Bash output through the shared classifier and records which blocks it would keep. It never shortens the model-facing output or replaces `structuredContent`. It is off by default. Shadow mode adds classifier latency and cost; it does not save context tokens.

## Enable a narrow trial

1. Choose a command whose output is safe to send to every provider in `classifier.providers`. An approval covers future executions of that exact command, not just one run. Do not approve commands that can print credentials, personal data, private source, or sensitive logs.
2. Merge the following into `~/.pi/agent/settings.json`, replacing the example directory, command, and goal. Preserve existing classifier routing settings.

   ```json
   {
     "classifier": {
       "toolOutputPilot": {
         "mode": "shadow",
         "approvedCommands": [
           {
             "cwd": "/absolute/path/to/project",
             "command": "your-public-output-command",
             "goal": "Identify the final result and any diagnostic evidence"
           }
         ]
       }
     }
   }
   ```

3. Run `/reload` after installing the extension. Later settings changes take effect on subsequent results. The project must be trusted, and both global and project classifier policy must permit requests.
4. Run the approved command through the top-level `bash` tool. Inspect the session's `tool-output-pilot` custom entries for `artifactPath` and `reportPath`.
5. Set `mode` to `"off"` to stop subsequent pilot requests. This does not cancel a request already in progress.

Only global settings can approve commands or enable the pilot. Directory and command matching are exact, with no globbing or shell normalization. The goal is static, so conversation text is never included automatically. The goal and complete eligible output are sent to the classifier. A secret-pattern check rejects some suspicious content, but cannot establish that an output is safe to send.

## Eligibility and limits

The pilot accepts successful, top-level Bash results with one text block matching the structured output, an explicit zero exit code, and no truncation. It skips nested calls, media, other tools, full-output-file references, and incomplete captures.

Eligible output is 8,000–32,000 UTF-8 bytes and must split into 3–16 whole-line blocks of at most 4,000 bytes each. Longer individual lines are excluded. There is at most one request in flight and eight attempts between session lifecycle resets. Restarting or reloading the extension resets its in-memory budget. The shared classifier's request limits, fallback providers, cooldowns, and usage accounting still apply.

The proposed selection retains the first and last blocks, blocks with common diagnostic markers, relevant blocks, and uncertain judgments. Only a relevance score below 1 with confidence of at least 0.8 can omit an unpinned block. These are advisory judgments, not proof that omitted material is irrelevant. Provider or validation failures retain every block.

## Review and retrieval

Each eligible attempt creates a private `pi-tool-output-pilot-*` directory under the system temporary directory. `output.txt` contains the exact model-facing text saved before classification. `report.json` records selected block ranges, proposed omitted bytes, elapsed time, and available usage. Directories use mode `0700`; files use mode `0600`. A storage failure may leave a partial artifact directory.

Read `artifactPath` to retrieve the complete output. Block offsets are half-open UTF-16 code-unit ranges, not byte offsets or file line numbers. Proposed byte savings exclude any future preview envelope and do not measure token savings or end-to-end speedups. Session entries contain report metadata and paths, not a second copy of the output.

Artifacts remain in the temporary directory until you or system cleanup remove them. The extension does not clean them up automatically or provide durable retrieval after cleanup. Disabling the pilot leaves existing reports and artifacts intact.

Before considering active compaction, review missed evidence and false omissions across representative approved commands. Keep source edits, hashline anchors, errors, and structured results outside the pilot's scope. No active mode is implemented.
