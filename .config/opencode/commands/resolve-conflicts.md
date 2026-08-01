---
description: Resolve git merge conflicts automatically when safe, and flag only complex cases
agent: build
---

Analyze the merge conflicts below and resolve every conflict that has a clear, safe resolution. Do not ask for confirmation, show a preview that requires a second invocation, or require an `auto` argument.

**Merge context:**

- Current branch: !`git rev-parse --abbrev-ref HEAD`
- Merging from: !`git log -1 MERGE_HEAD --pretty=format:"%h %s" 2>/dev/null || echo "Unknown (not in merge state)"`
- Conflicted files: !`git diff --name-only --diff-filter=U | wc -l` files

**Resolution preference:** $ARGUMENTS

- (no args) — merge compatible changes and choose the clearly correct side when one supersedes the other
- `keep-ours` — bias toward the current branch only when both sides are otherwise equally safe
- `keep-theirs` — bias toward the merge source only when both sides are otherwise equally safe

---

**If not in merge state** (no MERGE_HEAD):
Respond: "Not in a merge conflict state. Run `git merge <branch>` first or `git rebase` to create conflicts."
Stop here.

---

**For each conflicted file:**

1. **Show conflict location:**

   ```
   File: path/to/file.ext
   Lines: 42-58
   ```

2. **Explain both sides:**
   - **Ours (current branch):** What this side is trying to do
   - **Theirs (merge source):** What the other side is trying to do

3. **Resolve automatically whenever safe:**
    - If both sides can be preserved → merge both changes
    - If one side clearly supersedes → choose that side with rationale
    - If it is a mechanical conflict with an unambiguous result → apply the result
    - If the conflict is semantic, changes incompatible behavior, or its correctness cannot be determined from the available context → leave it unresolved and flag it for manual review

    Apply each safe resolution with the edit tool as part of this invocation. Remove all conflict markers from successfully resolved files, but do not modify conflicts that need manual review.

4. **Show the resolved code or explain why it was left unresolved:**
   ```typescript
   // Resolved version (no conflict markers)
   const result = merged_version;
   ```

**Output structure:**

## Resolved Conflicts

[For each resolved file: location, explanation, rationale, resolved code]

## Needs Manual Review

[For each unresolved file: location, explanation, and the specific decision required]

## Summary

- ✅ Applied: N conflicts
- ⚠️ Needs review: N conflicts (semantic or unsafe conflicts left unchanged)

---

When all conflicts were resolved, end with: "Applied resolutions to N files. Run `git add .` and `git merge --continue`."

When conflicts remain, end with: "Applied N safe resolutions. Resolve the M flagged conflicts, then run `git add .` and `git merge --continue`."

---

**Conflict details:**

!`git diff --diff-filter=U`

**Branch history (ours, last 5 commits):**
!`git log --oneline -5`

**Merge source history (theirs, last 5 commits):**
!`git log --oneline -5 MERGE_HEAD 2>/dev/null || echo "Not available"`
