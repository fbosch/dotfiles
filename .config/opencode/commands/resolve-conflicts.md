---
description: Analyze and resolve git merge conflicts with context-aware suggestions
model: anthropic/claude-sonnet-4-6
agent: build
---

Analyze the merge conflicts below and provide resolution recommendations.

**Merge context:**

- Current branch: !`git rev-parse --abbrev-ref HEAD`
- Merging from: !`git log -1 MERGE_HEAD --pretty=format:"%h %s" 2>/dev/null || echo "Unknown (not in merge state)"`
- Conflicted files: !`git diff --name-only --diff-filter=U | wc -l` files

**Mode:** $ARGUMENTS

**Available modes:**

- (no args) — Analysis + recommendations only (default, safe)
- `auto` — Apply resolutions automatically after showing preview
- `keep-ours` — Bias toward current branch when ambiguous
- `keep-theirs` — Bias toward merge source when ambiguous

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

3. **Recommend resolution:**
   - If both sides can be preserved → merge both changes
   - If conflict is semantic (incompatible logic) → flag for manual review
   - If one side clearly supersedes → choose that side with rationale

4. **Show resolved code:**
   ```typescript
   // Resolved version (no conflict markers)
   const result = merged_version;
   ```

**Output structure:**

## Conflict Analysis

[For each file: location, explanation, recommendation, resolved code]

## Summary

- ✅ Auto-resolvable: N conflicts
- ⚠️ Needs review: N conflicts (semantic conflicts flagged)

---

**If mode is `auto`:**

After showing the analysis above, ask:
"Apply these resolutions? This will modify N files. Type 'yes' to proceed."

If user confirms, use the edit tool to apply each resolution and respond:
"✅ Applied resolutions to N files. Run `git add .` and `git merge --continue`."

**If mode is NOT `auto`:**

End with: "To apply these resolutions, run `/resolve-conflicts auto` or apply manually."

---

**Conflict details:**

!`git diff --diff-filter=U`

**Branch history (ours, last 5 commits):**
!`git log --oneline -5`

**Merge source history (theirs, last 5 commits):**
!`git log --oneline -5 MERGE_HEAD 2>/dev/null || echo "Not available"`
