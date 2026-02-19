# Delegation Patterns

Best practices for delegating tasks to subagents, including batch processing, parallel execution, and workflow optimization.

## The Sweet Spot

**Best use case**: Tasks that are **repetitive but require judgment**.

✅ **Good fit:**
- Audit 70 skills (repetitive) checking versions against docs (judgment)
- Update 50 files (repetitive) deciding what needs changing (judgment)
- Research 10 frameworks (repetitive) evaluating trade-offs (judgment)

❌ **Poor fit:**
- Simple find-replace (no judgment needed, use bash/grep)
- Single complex task (not repetitive, do it directly)
- Tasks with cross-item dependencies (agents work independently)

## Core Prompt Template

This 5-step structure works consistently:

```markdown
For each [item]:
1. Read [source file/data]
2. Verify with [external check - npm view, API, docs]
3. Check [authoritative source]
4. Evaluate/score
5. FIX issues found ← Critical: gives agent authority to act
```

**Key elements:**

- **"FIX issues found"** - Without this, agents only report. With it, they take action.
- **Exact file paths** - Prevents ambiguity and wrong-file edits
- **Output format template** - Ensures consistent, parseable reports
- **Item list** - Explicit list of what to process

## Batch Sizing

| Batch Size | Use When |
|------------|----------|
| 3-5 items | Complex tasks (deep research, multi-step fixes) |
| 5-8 items | Standard tasks (audits, updates, validations) |
| 8-12 items | Simple tasks (version checks, format fixes) |

**Why not more?**

- Agent context fills up
- One failure doesn't ruin entire batch
- Easier to review smaller changesets

**Parallel agents**: Launch 2-4 agents simultaneously, each with their own batch.

## Workflow Pattern

```text
┌─────────────────────────────────────────────────────────────┐
│  1. PLAN: Identify items, divide into batches               │
│     └─ "58 skills ÷ 10 per batch = 6 agents"                │
├─────────────────────────────────────────────────────────────┤
│  2. LAUNCH: Parallel task tool calls with identical prompts │
│     └─ Same template, different item lists                  │
├─────────────────────────────────────────────────────────────┤
│  3. WAIT: Agents work in parallel                           │
│     └─ Read → Verify → Check → Edit → Report                │
├─────────────────────────────────────────────────────────────┤
│  4. REVIEW: Check agent reports and file changes            │
│     └─ git status, spot-check diffs                         │
├─────────────────────────────────────────────────────────────┤
│  5. COMMIT: Batch changes with meaningful changelog         │
│     └─ One commit per tier/category, not per agent          │
└─────────────────────────────────────────────────────────────┘
```

## Automatic Delegation

Primary agents proactively delegate based on:

- Task description in your request
- `description` field in subagent config
- Current context and available tools

**Tip**: Include "use PROACTIVELY" or "MUST BE USED" in description for more automatic invocation.

## Explicit Invocation

```text
> Use the test-runner subagent to fix failing tests
> @code-reviewer look at my recent changes
> Ask the @debugger subagent to investigate this error
```

Use the `@` mention to explicitly invoke a specific subagent.

## Commit Strategy

**Agents don't commit** - they only edit files. This is by design:

| Agent Does | Human Does |
|------------|------------|
| Research & verify | Review changes |
| Edit files | Spot-check diffs |
| Score & report | git add/commit |
| Create summaries | Write changelog |

**Why?**

- Review before commit catches agent errors
- Batch multiple agents into meaningful commits
- Clean commit history (not 50 tiny commits)
- Human decides commit message/grouping

**Commit pattern:**

```bash
git add [files] && git commit -m "$(cat <<'EOF'
[type]([scope]): [summary]

[Batch 1 changes]
[Batch 2 changes]
[Batch 3 changes]
EOF
)"
```

## Error Handling

### When One Agent Fails

1. Check the error message
2. Decide: retry that batch OR skip and continue
3. Don't let one failure block the whole operation

### When Agent Makes Wrong Change

1. `git diff [file]` to see what changed
2. `git checkout -- [file]` to revert
3. Re-run with more specific instructions

### When Agents Conflict

Rare (agents work on different items), but if it happens:

1. Check which agent's change is correct
2. Manually resolve or re-run one agent

## Context Considerations

Agent context usage depends heavily on the task:

| Scenario | Context | Tool Calls | Works? |
|----------|---------|------------|--------|
| Deep research agent | 130k | 90+ | ✅ Yes |
| Multi-file audit | 80k+ | 50+ | ✅ Yes |
| Simple format check | 3k | 5-10 | ✅ Yes |
| Chained orchestration | Varies | Varies | ✅ Depends |

**Reality**: Agents with 90+ tool calls and 130k context work fine when doing meaningful work. The limiting factor is task complexity, not arbitrary token limits.

**What actually matters**:

- Is the agent making progress on each tool call?
- Is context being used for real work vs redundant instructions?
- Are results coherent at the end?

**When context becomes a problem**:

- Agent starts repeating itself or losing track
- Results become incoherent or contradictory
- Agent "forgets" earlier findings in long sessions

## Persona-Based Routing

Prevent agents from drifting into adjacent domains with explicit constraints:

```markdown
---
description: Frontend code expert. NEVER writes backend logic.
mode: subagent
tools:
  read: true
  write: true
  edit: true
  glob: true
  grep: true
---

You are a frontend specialist.

BOUNDARIES:
- NEVER write backend logic, API routes, or database queries
- ALWAYS use React patterns consistent with the codebase
- If task requires backend work, STOP and report "Requires backend specialist"

FOCUS:
- React components, hooks, state management
- CSS/Tailwind styling
- Client-side routing
- Browser APIs
```

This prevents hallucination when agents encounter unfamiliar domains.
