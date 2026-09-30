# Local /btw fork

Ask a side question without adding the question or answer to the main conversation.
This is a locally maintained derivative of [Fatih0234/btw](https://github.com/Fatih0234/btw/blob/931930656e8d101b20d3155550f77832237d35ee/btw.ts), adapted for Pi 0.99.1.

## Use

1. Run `just stow-apply` after changing the extension files, then `/reload` in Pi.
2. Let the main agent make a model request so the extension can capture an outbound snapshot.
3. Run `/btw <question>`. Dismiss the answer to cancel any remaining request.
4. Run `/btw-settings` to choose a model, reasoning level, and output-token limit.

The defaults are the main model, reasoning off, and 500 output tokens.
Requests have a 60-second deadline. Limits are 2 KB for questions, 2 MB and
2,048 messages for captured context, and 32 KB or 4,096 text deltas for answers.
Settings live in the machine-local `~/.pi/agent/btw-settings.json`, not in session entries.
The old `pi-btw.json` belongs to a different extension and is not imported.

## Security review

The upstream review found these issues:

| Severity | Upstream behavior | Local control |
| --- | --- | --- |
| High | Raw session reconstruction bypasses outbound context filters. | Replay only an observed `context_with_system` snapshot; never reconstruct session history. |
| High | Settings from the entire session tree can change the destination provider. | Do not restore settings from session entries; require confirmation on each cross-provider request. |
| Medium | Untrusted text can carry terminal control sequences. | Sanitize answers, questions, model labels, and errors before terminal rendering. |
| Medium | Cached context can survive branch navigation. | Invalidate snapshots and cancel active work on session and branch lifecycle changes. |
| Medium | Widget disposal can leave provider requests running. | Use shared cancellation and cleanup, with a request deadline and size limits. |

A missing custom model is an error, not permission to use another model.
The side request has no executable tools. Structured tool calls terminate it;
instructions telling the model not to use tools are not the security boundary.
Provider errors are summarized without displaying their raw bodies.

## Limits

- The snapshot contains context observed before a main model request. It can omit
  the latest assistant reply or other changes not yet included in a request.
  `/btw` refuses when no valid snapshot exists instead of falling back to raw history.
- `context_with_system` runs after ordinary context handlers, but later
  `context_with_system` handlers and payload-level filters can still change the
  actual main request. This extension does not guarantee identical final payloads
  or replay every downstream redaction policy. If disclosure depends on those
  later filters, do not use `/btw` without applying that policy here too.
- Cross-provider confirmation authorizes sending the captured conversation,
  including system instructions and tool output, to that provider. Same-provider
  requests still transmit that context again. There is no automatic secret detector.
- The local extension does not append side answers to the session. Provider
  retention and terminal scrollback are outside that guarantee.
- Cache reuse is best-effort. Tool removal, safety instructions, model changes,
  and Pi's transcript conversion can alter the cache prefix.
- Generated answers can contain misleading advice or unsafe suggested commands.
  They are displayed, never executed.

## Maintenance

`index.ts` is the auto-discovered entry point. Regression tests live in `__tests__/`.
Use the existing Pi extension checks through `devenv test`; focused tests can also
be run with `cd .pi/agent && bun test extensions/btw`.

The vendored baseline is upstream commit `931930656e8d101b20d3155550f77832237d35ee`.
The original `btw.ts` SHA-256 is
`790d596bcc630e579e3efffd54ec0be71314892b93ddec30e0b56aa4f59d13a7`.
No license file or package license declaration was present in the inspected
upstream revision. Attribution is retained; redistribution permission is unresolved.
Do not represent this code as having an upstream open-source license.
