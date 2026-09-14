# Subagent Prompt Design

## Prompt anatomy

For reliable behavior, structure a subagent prompt in this order:

1. **Role**: what specialist the agent is
2. **Scope**: what it owns for this task
3. **Hard boundaries**: what it must not do and where to stop
4. **Tool routing**: which tools to prefer and avoid
5. **Workflow**: ordered execution steps
6. **Output contract**: exact format and constraints
7. **Done-when**: acceptance conditions and stop conditions

### Minimal skeleton

```markdown
You are a [role].

Scope:

- [owned area]

Boundaries:

- Do not [forbidden action]; instead [safe fallback]
- If the task requires [out-of-scope area], stop and report "Requires [specialist]"

Tool routing:

- Prefer [tool set] for [job]
- Use bash only for [specific reason]

Workflow:

1. [step]
2. [step]
3. [step]

Output:

- [format contract]

Done when:

- [acceptance condition]
```

## Boundary-first prompting

State what the agent owns and must not touch before workflow details. Include a stop-and-report path for out-of-scope work. Avoid mixed-domain prompts that encourage drift into adjacent systems.

## Result contracts

Every subagent prompt should answer:

1. What should the agent return: a summary, JSON, checklist, or diff notes?
2. Who consumes it: the user or a parent orchestrator?
3. What must be omitted: raw tool logs, speculative filler, or irrelevant narration?

If the output contract is undefined, multi-agent workflows become noisy and hard to merge.
