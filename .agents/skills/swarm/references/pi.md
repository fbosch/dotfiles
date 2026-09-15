# Pi adapter

Pi discovers the shared `.agents/skills/swarm/SKILL.md` without a duplicate under `.pi/skills/`. When skill commands are enabled, invoke it with `/skill:swarm <task>`. Its description also allows automatic selection. A newly added skill may require `/reload` before it appears.

Delegation tools depend on installed extensions. Inspect the current tool schemas; the names below describe this dotfiles setup, not a requirement of Pi itself. Use documented equivalents if names differ. If tools are inactive, use tool discovery when available. If no delegation tool exists, follow the sequential fallback in the main skill.

## Tool mapping

| Workflow                            | Tools in this setup                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| Track phases                        | `todo`; one task in progress at a time                                                     |
| Launch worker                       | `subagent` with `run_in_background: true`                                                  |
| Launch independent workers together | `multi_tool_use.parallel` wrapping background `subagent` calls                             |
| Collect                             | Completion notifications, then `get_subagent_result`; use `wait: true` for a blocking wait |
| Correct scope mid-run               | `steer_subagent` for a running background worker                                           |
| Continue a finished worker          | `subagent` with `resume` set to its identifier                                             |

Select an available specialist such as `explore`, `research`, `review`, `test`, or `quick` according to its advertised role and permissions. Use a general agent only when no specialist fits. Omit `model` to retain the agent's configured default unless the task requires an override; some agents lock their model.

Supply `prompt`, `description`, and `subagent_type` on launch. Put the full worker brief in `prompt`; include `max_turns` when a turn budget is useful. Set `inherit_context: false` for self-contained briefs, or enable inheritance deliberately when conversation context is needed. Neither setting isolates filesystem writes.

Do not pass Cursor-only fields such as `environment` or `cloud_base_branch`. A background call does not imply a cloud sandbox, separate branch, or separate worktree. Confirm the actual working directory and isolation before permitting writes.

This setup exposes steering but no dedicated cancellation tool. Asking a worker to stop is not proof it has stopped. Drain all launched workers through terminal results before final integration or reporting, including unselected first-pass race arms. Do not invent a cancellation call.

## Example: two independent reviews

For a request to review parser correctness and CLI error handling:

1. Frame two read-only coverage slices with exact source paths and acceptance criteria.
2. Launch two available `review` workers together, each with `run_in_background: true`, a self-contained brief, and explicit exclusions for the other slice. Keep overlapping concerns with the coordinator.
3. Record both returned identifiers. Use completion notifications or blocking collection rather than repeated polling.
4. Verify findings against the referenced code, resolve cross-cutting issues, and return one severity-ordered report with evidence and gaps.

If only one worker slot is available, run the same slices sequentially and report the reduced concurrency. Do not change configuration or install an extension merely to force parallel execution.
