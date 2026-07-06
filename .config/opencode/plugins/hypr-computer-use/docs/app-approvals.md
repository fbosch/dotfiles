# App Approvals

`app-approval` is a read-only approval evaluator for Hyprland computer-use routes. It does not click, type, dispatch Hyprland commands, mutate the clipboard, automate browser pages, or persist approval rules.

Set `includeCapture: true` to capture the resolved target region in the same call. This avoids a second focus-sensitive `active-window` capture after approval.

## Approval States

| State | Meaning |
| --- | --- |
| `ask` | Unknown normal app target. The response includes prompt metadata for user review. |
| `denied` | Unsupported or unsafe target, such as terminal GUI automation, OpenCode/Codex self-targets, privileged prompts, ambiguous targets, missing targets, browser page interaction, or persistent approval requests. |
| `sensitive` | The target or request context includes account, payment, credential, privacy, or security signals. Ordinary app approval is insufficient. |

## Boundaries

- Unknown normal apps default to `ask`, not `approved`.
- Terminal GUI automation is denied; use normal OpenCode shell tools instead.
- OpenCode, Codex, agent approval, and tool-permission windows are denied.
- Privileged, authentication, security, and permission prompts require human handling.
- Browser page interaction is delegated to `agent-browser` or available `chrome-devtools` tools.
- `persistApproval` is rejected until a separate persistent policy capability exists.

Evidence records include target metadata, approval state, matched signals, and recommendation text. They do not read clipboard contents or inline screenshot bytes.
