# Linear Prompt Parsing

Use this reference when the user pastes a Linear prompt that includes XML-like issue data.

## Expected Prompt Shape

Common pattern:

1. Plain text lead-in, for example `Work on Linear issue INF-45:`
2. Embedded block:

```xml
<issue identifier="INF-45">
  <title>...</title>
  <description>...</description>
  <team name="..."/>
  <label>...</label>
  <project name="..."/>
</issue>
```

## Field Mapping

Map from prompt block to intake model:

- `issue/@identifier` -> issue id
- `title` -> issue title
- `description` -> scope, acceptance criteria, notes
- `team/@name` -> team context
- repeated `label` -> labels list
- `project/@name` -> project context

Treat `<description>` as primary implementation intent when present.

## Intake Rules

1. Parse prompt block first when present.
2. Do not discard parsed scope because Linear API metadata differs; preserve user-provided acceptance criteria.
3. Call `linear_get_issue` only to enrich missing operational fields (`gitBranchName`, assignee, workflow state) or to verify access.
4. If parsed identifier conflicts with explicitly provided id, stop and ask which one to trust.

## Failure Cases

- Missing `identifier` -> request explicit issue id.
- Missing `description` -> fetch issue details/comments before implementation.
- Malformed tags -> recover obvious fields, then confirm parsed result before coding.

## Output Requirement

In issue summary output, include `source: prompt`, `source: linear`, or `source: merged` so the user can verify where scope came from.
