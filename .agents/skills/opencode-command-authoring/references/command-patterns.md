# OpenCode Command Patterns

Four annotated archetypes for common command use cases. Use these as templates.

## Pattern 1: Strict Output (Single-Line, Cheap Model)

**Use case:** Commit messages, PR titles, or any single-line deterministic output.

**Key traits:**
- Cheap/fast model override (haiku, fast-claude, etc.)
- Heavy shell injection for project context
- Hard output constraint: "Output ONLY X. No markdown, no preamble."
- Example: `commit-msg.md`

**Template:**
```markdown
---
description: Generate a Commitizen commit message for staged changes
model: github-copilot/claude-haiku-4.5
---

Output a single-line Commitizen commit message (≤50 chars) for the staged changes below.

Format: `<type>(<scope>): <subject>`

Where:
- type: feat, fix, docs, style, refactor, test, chore
- scope: affected module (optional)
- subject: imperative, lowercase, no period

**Current context:**
- Branch: !`git rev-parse --abbrev-ref HEAD`
- Last commit: !`git log -1 --pretty=format:"%s" 2>/dev/null || echo "(no commits)"`

**Output:** ONLY the commit message. First character must be the commit type. No markdown blocks, no explanations, no questions.

STAGED DIFF:
!`git diff --cached`
```

**Why this works:**
- Model override saves cost/latency on formulaic output
- Shell injection gives LLM exact branch and diff (no guessing)
- Explicit constraint enforces strict format
- User sees single-line output immediately

---

## Pattern 2: Structured Report (Multi-Section, Model Metadata)

**Use case:** PR descriptions, code reviews, design documents.

**Key traits:**
- Cheap model (deterministic structure)
- Shell injection for metadata (branch, commits, base)
- `$ARGUMENTS` for user-provided content (e.g., truncated diff)
- Section-based output with clear limits
- Example: `pr-desc.md`

**Template:**
```markdown
---
description: Generate a PR description comparing current branch against main/master
model: github-copilot/claude-haiku-4.5
---

Generate a PR description in markdown for the branch below.

**Context:**
- Branch: !`git rev-parse --abbrev-ref HEAD`
- Base: !`git show-ref --verify --quiet refs/heads/main && echo main || echo master`
- Commits: !`git log --oneline $(git merge-base HEAD origin/main)..HEAD 2>/dev/null | head -10`
- Author: !`git config --get user.name 2>/dev/null || echo "unknown"`

**Structure (≤300 words total):**
1. **Title** (≤72 chars, future-tense verb)
2. **Summary** (1-2 sentences, what this PR does)
3. **Changes** (bullet list, key modifications)
4. **Testing** (how tested, what to verify)
5. **Notes** (any caveats, breaking changes, or follow-up)

**Output:** Markdown. First line is the PR title. No preamble, no code blocks, no "Here's your PR description".

DIFF (may be truncated for large PRs):
$ARGUMENTS
```

**Why this works:**
- Shell context provides branch, commits, base branch automatically
- Structured sections guide output format
- `$ARGUMENTS` allows user to paste or pipe diff without reparsing
- Character limits prevent bloat

---

## Pattern 3: Workflow Trigger (Build Agent, Integration)

**Use case:** Run code generation, tests, linting, or other integrations based on project state.

**Key traits:**
- `agent: build` (full tool access)
- Shell injection for test output, lint results
- No model override (use default reasoning)
- User arguments trigger the workflow

**Template:**
```markdown
---
description: Generate TypeScript types from GraphQL schema
agent: build
---

Generate TypeScript types from the GraphQL schema using a code generator.

**Context:**
- Project type: !`jq -r .name < package.json`
- GraphQL schema: !`ls -la src/schema.graphql`
- Recent codegen runs: !`cat tsconfig.json | jq .compilerOptions.outDir`

**User request:** $ARGUMENTS

**Workflow:**
1. Read the GraphQL schema at `src/schema.graphql`
2. Generate TypeScript types using graphql-code-generator
3. Write output to `src/generated/types.ts`
4. Run `npm run lint -- --fix src/generated/types.ts` to format
5. Summarize what was generated

If issues occur, ask the user before making changes.
```

**Why this works:**
- Build agent can create files and run tools
- Shell injection shows schema path and project context
- No model override allows reasoning about the schema
- User provides request details via `$ARGUMENTS`

---

## Pattern 4: Isolated Subtask (Clean Context, Artifact Return)

**Use case:** Analysis that produces a report or artifact without polluting main conversation history.

**Key traits:**
- `subtask: true` (runs in isolation)
- No agent override (uses general reasoning)
- Produces structured output (JSON, markdown, CSV)
- Returns result to main session

**Template:**
```markdown
---
description: Analyze codebase for performance bottlenecks and generate report
subtask: true
---

Analyze the codebase for performance bottlenecks and return a structured report.

**Read these files to understand the codebase:**
@src/core/engine.ts
@src/utils/cache.ts
@src/server/api.ts

**Analysis checklist:**
- Nested loops or O(n²) algorithms?
- Synchronous I/O that could be async?
- Repeated expensive computations without caching?
- Large data structures in memory?
- Missing indexes or query optimizations?

**Output format (JSON):**
```json
{
  "summary": "High-level findings",
  "bottlenecks": [
    {
      "file": "src/core/engine.ts",
      "line": 42,
      "issue": "Description",
      "severity": "high|medium|low",
      "suggestion": "How to fix"
    }
  ],
  "recommendations": ["Priority 1", "Priority 2"]
}
```

Return ONLY the JSON. No markdown wrapper, no explanations.
```

**Why this works:**
- `subtask: true` keeps analysis isolated; output returned as artifact
- No model override uses full reasoning for deep analysis
- Structured JSON output integrates cleanly with main session
- User can review report without cluttering conversation

---

## Comparison Matrix

| Pattern | Agent | Model | Output | Use Case |
|---------|-------|-------|--------|----------|
| **Strict** | (any) | Cheap | Single-line, deterministic | Commits, titles, formatted code |
| **Report** | (any) | Cheap | Multi-section, markdown | PR descriptions, reviews, docs |
| **Workflow** | build | (default) | Integration/changes | Code generation, tests, deploy |
| **Subtask** | (any) | (default) | Structured artifact | Analysis, reports, planning |

---

## Checklist: Before Publishing a Command

- [ ] Does the command name avoid `/init`, `/undo`, `/redo`, `/share`, `/help`, `/review`?
- [ ] Is scope clear (global vs. per-project)?
- [ ] Does it use shell injection instead of asking LLM to guess state?
- [ ] Is output format explicit (single-line? sections? JSON?)?
- [ ] For strict-output commands: is model overridden to cheap/fast?
- [ ] For commands with arguments: is format documented?
- [ ] Have you tested it in the TUI with `/command-name`?
- [ ] Does description match what the command actually does?
