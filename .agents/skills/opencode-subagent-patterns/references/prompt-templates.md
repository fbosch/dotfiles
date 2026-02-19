# Prompt Templates

Proven prompt templates for common subagent patterns. These templates consistently produce reliable results across different types of batch operations.

## Audit/Validation Pattern

Use when you need to verify consistency, check versions, or validate against standards.

```markdown
Deep audit these [N] [items]. For each:

1. Read the [source file] from [path]
2. Verify [versions/data] with [command or API]
3. Check official [docs/source] for accuracy
4. Score 1-10 and note any issues
5. FIX issues found directly in the file

Items to audit:
- [item-1]
- [item-2]
- [item-3]

For each item, create a summary with:
- Score and status (PASS/NEEDS_UPDATE)
- Issues found
- Fixes applied
- Files modified

Working directory: [absolute path]
```

**Example use case:**

```markdown
Deep audit these 8 skills. For each:

1. Read the SKILL.md file from ~/.config/opencode/skills/[skill-name]/
2. Verify package versions mentioned with `npm view [package]`
3. Check official documentation for API accuracy
4. Score 1-10 for documentation quality and note any issues
5. FIX outdated versions and incorrect API usage directly in the file

Items to audit:
- pdf-processor
- docx-editor
- image-transformer
- csv-analyzer
- json-validator
- yaml-parser
- markdown-formatter
- html-generator

For each skill, create a summary with:
- Score and status (PASS/NEEDS_UPDATE)
- Issues found (outdated versions, wrong APIs, unclear docs)
- Fixes applied
- Files modified

Working directory: /Users/username/.config/opencode/skills
```

## Bulk Update Pattern

Use when applying consistent changes across multiple files or components.

```markdown
Update these [N] [items] to [new standard/format]. For each:

1. Read the current file at [path pattern]
2. Identify what needs changing
3. Apply the update following this pattern:
   [show example of correct format]
4. Verify the change is valid
5. Report what was changed

Items to update:
- [item-1]
- [item-2]
- [item-3]

Output format:
| Item | Status | Changes Made |
|------|--------|--------------|

Working directory: [absolute path]
```

**Example use case:**

```markdown
Update these 12 agent configurations to use the new permission format. For each:

1. Read the current file at .opencode/agents/[agent-name].md
2. Identify permission settings that need updating
3. Apply the update following this pattern:
   ```markdown
   ---
   permission:
     edit: ask
     bash:
       "*": ask
       "git status": allow
   ---
   ```
4. Verify the YAML is valid
5. Report what was changed

Items to update:
- code-reviewer
- test-runner
- doc-validator
- security-auditor
- performance-analyzer
- refactoring-assistant
- api-designer
- database-migrator
- frontend-builder
- backend-scaffolder
- deployment-manager
- monitoring-setup

Output format:
| Agent | Status | Changes Made |
|-------|--------|--------------|

Working directory: /Users/username/project/.opencode/agents
```

## Research/Comparison Pattern

Use when evaluating multiple options, frameworks, or tools.

```markdown
Research these [N] [options/frameworks/tools]. For each:

1. Check official documentation at [URL pattern or search]
2. Find current version and recent changes
3. Identify key features relevant to [use case]
4. Note any gotchas, limitations, or known issues
5. Rate suitability for [specific need] (1-10)

Options to research:
- [option-1]
- [option-2]
- [option-3]

Output format:
## [Option Name]
- **Version**: X.Y.Z
- **Key Features**: ...
- **Limitations**: ...
- **Suitability Score**: X/10
- **Recommendation**: ...
```

**Example use case:**

```markdown
Research these 5 LLM providers for our use case. For each:

1. Check official documentation and pricing pages
2. Find current API version and recent changes
3. Identify key features relevant to code generation and reasoning
4. Note any rate limits, limitations, or known issues
5. Rate suitability for our needs (1-10)

Providers to research:
- Anthropic Claude
- OpenAI GPT
- Google Gemini
- Mistral AI
- Meta Llama

Output format:
## [Provider Name]
- **Latest Model**: ...
- **Pricing**: ...
- **Key Features**: ...
- **Rate Limits**: ...
- **Limitations**: ...
- **Suitability Score**: X/10
- **Recommendation**: ...
```

## Migration Pattern

Use when migrating code, configurations, or data to new formats or systems.

```markdown
Migrate these [N] [items] from [old format] to [new format]. For each:

1. Read the current [old format] file at [path]
2. Parse the existing structure and data
3. Transform to [new format] following this pattern:
   [show example of correct new format]
4. Validate the migrated version
5. Save as [new path/format] and report results

Items to migrate:
- [item-1]
- [item-2]
- [item-3]

For each item, report:
- Source file
- Destination file
- Transformation applied
- Validation status
- Any warnings or issues

Working directory: [absolute path]
```

**Example use case:**

```markdown
Migrate these 10 agent configurations from JSON to Markdown format. For each:

1. Read the current JSON config from opencode.json
2. Parse the agent configuration
3. Transform to Markdown following this pattern:
   ```markdown
   ---
   description: [from JSON description]
   mode: [from JSON mode]
   model: [from JSON model]
   tools:
     write: [boolean]
     edit: [boolean]
   ---
   
   [prompt from JSON]
   ```
4. Validate the YAML frontmatter
5. Save as .opencode/agents/[agent-name].md and report results

Agents to migrate:
- code-reviewer
- test-runner
- doc-validator
- security-auditor
- performance-analyzer
- refactoring-assistant
- api-designer
- database-migrator
- frontend-builder
- backend-scaffolder

For each agent, report:
- Source: opencode.json agent.[name]
- Destination: .opencode/agents/[name].md
- Transformation applied
- Validation status (YAML valid?)
- Any warnings (missing fields, etc.)

Working directory: /Users/username/project
```

## Template Customization

### Making Templates Specific

The more specific your template, the better the results:

**Generic (okay results):**
```markdown
Update these files to the new format.
```

**Specific (great results):**
```markdown
Update these [N] [specific type] files to [specific new format]. For each:

1. Read from [exact path pattern]
2. Identify [specific elements to change]
3. Apply [exact transformation with example]
4. Verify [specific validation criteria]
5. Report [specific metrics]
```

### Authority vs Reporting

Including "FIX issues found" is critical for action-taking agents:

**Report-only (agent just lists problems):**
```markdown
1. Read the file
2. Check for issues
3. Report findings
```

**Action-taking (agent fixes problems):**
```markdown
1. Read the file
2. Check for issues
3. FIX issues found directly in the file
4. Report what was fixed
```

### Output Format Consistency

Always include an output format template to ensure parseable results:

```markdown
Output format:
| Item | Status | Metric | Changes |
|------|--------|--------|---------|

# OR

For each item, report:
- **Name**: 
- **Status**: PASS/FAIL
- **Issues**: ...
- **Fixes Applied**: ...
```

This makes it easy to scan results and identify problems.
