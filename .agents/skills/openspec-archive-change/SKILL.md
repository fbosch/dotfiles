---
name: openspec-archive-change
description: Archive a completed change in the experimental workflow. Use when the user wants to finalize and archive a change after implementation is complete.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.2.0"
---

Archive a completed change in the experimental workflow.

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Steps**

1. **If no change name provided, prompt for selection**

   Run `openspec list --json` to get available changes. Use the **AskUserQuestion tool** to let the user select.

   Show only active changes (not already archived).
   Include the schema used for each change if available.

   **IMPORTANT**: Do NOT guess or auto-select a change. Always let the user choose.
   If the selection is cancelled, stop immediately without writing anything.

2. **Check artifact completion status**

   Run `openspec status --change "<name>" --json` to check artifact completion.

   Parse the JSON to understand:
   - `schemaName`: The workflow being used
   - `artifacts`: List of artifacts with their status (`done` or other)

   **If any artifacts are not `done`:**
   - Display warning listing incomplete artifacts
   - Use **AskUserQuestion tool** to confirm user wants to proceed
   - Stop without writes if the user does not affirm proceeding

3. **Check task completion status**

   Read the tasks file (typically `tasks.md`) to check for incomplete tasks.
   Count tasks marked with `- [ ]` (incomplete) vs `- [x]` (complete).

   **If incomplete tasks found:**
   - Display warning showing count of incomplete tasks
   - Use **AskUserQuestion tool** to confirm user wants to proceed
   - Stop without writes if the user does not affirm proceeding

   **If no tasks file exists:** Proceed without task-related warning.

4. **Assess delta spec sync state and obtain archive consent**

   Check for delta specs at `openspec/changes/<name>/specs/`. If none exist, proceed to an archive confirmation.

   **If delta specs exist:**
   - Compare each delta spec with its corresponding main spec at `openspec/specs/<capability>/spec.md`
   - Determine what changes would be applied (adds, modifications, removals, renames)
   - Show a combined summary before prompting

   **Prompt options:**
   - If changes are needed: **"Sync now, then archive (recommended)"**, **"Archive without syncing"**, **"Cancel"**
   - If already synced: **"Archive now"**, **"Sync again, then archive"**, **"Cancel"**

   The options that include archive are the required affirmative archive consent. If the user chooses **Cancel**, stop immediately without writes. Do not create the archive directory, move the change, or invoke sync.

   If the user chooses a sync option, use Task tool (subagent_type: "general-purpose", prompt: "Use Skill tool to invoke openspec-sync-specs for change '<name>'. Delta spec analysis: <include the analyzed delta spec summary>"). Require an explicit successful result from that task before continuing. If the task fails, is cancelled, or does not report success, display the failure and stop; do not create the archive directory or move the change.

   If there are no delta specs, use **AskUserQuestion tool** with **"Archive now"** and **"Cancel"**. Continue only after the user chooses **"Archive now"**; cancellation stops without writes.

5. **Perform the archive**

   Only after affirmative archive consent and, when requested, a successful sync:

   Create the archive directory if it doesn't exist:

   ```bash
   mkdir -p openspec/changes/archive
   ```

   Generate target name using current date: `YYYY-MM-DD-<change-name>`

   **Check if target already exists:**
   - If yes: Fail with error, suggest renaming existing archive or using different date
   - If no: Move the change directory to archive

   ```bash
   mv openspec/changes/<name> openspec/changes/archive/YYYY-MM-DD-<name>
   ```

6. **Display summary**

   Show archive completion summary including:
   - Change name
   - Schema that was used
   - Archive location
   - Whether specs were synced (if applicable)
   - Note about any warnings (incomplete artifacts/tasks)

**Output On Success**

```
## Archive Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Archived to:** openspec/changes/archive/YYYY-MM-DD-<name>/
**Specs:** ✓ Synced to main specs (or "No delta specs" or "Sync skipped")

All artifacts complete. All tasks complete.
```

**Guardrails**

- Always prompt for change selection if not provided
- Use artifact graph (`openspec status --json`) for completion checking
- Don't block archive on warnings; just inform and obtain confirmation
- Stop without writes when the user cancels any pre-write confirmation
- Archive only after an explicit affirmative archive choice
- If sync is requested, require a successful `openspec-sync-specs` result before archiving
- Preserve `.openspec.yaml` when moving to archive (it moves with the directory)
- Show clear summary of what happened
- If delta specs exist, always run the sync assessment and show the combined summary before prompting
