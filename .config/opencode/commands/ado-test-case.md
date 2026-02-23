---
description: Fetch Azure DevOps test case and format for agent context
model: github-copilot/claude-haiku-4.5
---

Fetch and structure Azure DevOps test case data for agent context.

Test Case ID: $ARGUMENTS

**If $ARGUMENTS is empty:** Respond only with: "Usage: /ado-test-case <test-case-id>"

**Fetched data:**
!`~/.config/opencode/scripts/fetch-ado-case.sh "$ARGUMENTS"`

**Output format:**

```markdown
# Test Case #<ID>: <Title>

## Details
- **State:** <state>
- **Assigned To:** <assignee>
- **Area Path:** <area>
- **Iteration:** <iteration>

## Test Steps

### Step 1
<action>

**Expected:**  
<expected>

### Step 2
<action>

**Expected:**  
<expected>

### Step 3
<action>

**Expected:**  
<expected>
```

**Processing rules:**

- Extract: `System.Title`, `System.State`, `System.AssignedTo.displayName`, `System.AreaPath`, `System.IterationPath`, `Microsoft.VSTS.TCM.Steps`
- Parse test steps XML: decode HTML entities, extract step action + expected result pairs
- Format each step as: `### Step N` heading, followed by action text on next line, then blank line, then `**Expected:**` with two trailing spaces, then expected text on next line
- If expected result is empty, "N/A", or missing: use "N/A" on the line after `**Expected:**`
- If field missing: use "N/A" or "Unassigned" for assignee
- If JSON contains `"ERROR:"` prefix: Output only the error message as-is
- **CRITICAL:** Output the expected test outcome EXACTLY as written in the test case. Do not rewrite, rephrase, summarize, or alter the expected result text in any way. Preserve original wording, formatting, and structure.

**Error handling:**

- If output contains `"ERROR:"` prefix: Display only the error message as-is

**Strict output:** Output ONLY the formatted markdown. First line must be the heading. No preamble, no "Here is", no explanations.
