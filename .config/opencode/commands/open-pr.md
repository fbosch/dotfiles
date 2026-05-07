---
description: Open a pull request for the current branch on GitHub or Azure DevOps
agent: build
---

Open a pull request for the current branch.

Use the `open_pr` tool for all git metadata detection, provider routing, pushing, and PR creation. Do not run inline shell for PR opening.

PR content policy:
@.config/opencode/commands/pr-desc.md

Additional context:
$ARGUMENTS

Instructions:

1. Call `open_pr` with no arguments to get detected provider and branch context.
2. If tool output starts with `ERROR:`, output only that error and stop.
3. Use the returned context plus git diffs/commits you inspect with normal tools to generate PR content using the `pr-desc` command policy above: first line is title, remaining lines are markdown body.
4. If generated PR content would be one of the `Cannot generate PR description:` errors, output only that error and stop.
5. Call `open_pr` with `title` and `body` from the generated PR content.
6. If tool output starts with `ERROR:`, output only that error and stop.
7. On success, output only the PR URL or success output returned by the tool.
