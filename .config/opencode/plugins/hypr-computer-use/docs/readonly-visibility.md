# Read-Only Visibility Boundary

The first `hypr-computer-use` slice exposes desktop visibility only. It can identify Hyprland state, create active-target snapshots, capture scoped screenshots, and write metadata-first evidence records.

## Exposed Tool

| Tool | Purpose |
| --- | --- |
| `hypr_computer_use_readonly` | Read Hyprland state, create target snapshots, capture scoped screenshots, evaluate app approvals, and run guarded explicit keyboard input. |

## Modes

| Mode | Behavior |
| --- | --- |
| `state` | Returns monitors, workspaces, clients, active-window metadata, and a metadata evidence record. |
| `snapshot` | Returns the normalized active-target snapshot or `null` when no active target exists. |
| `capture` | Captures an explicit screenshot scope and records screenshot metadata. |
| `keyboard` | Sends guarded explicit keys/chords/sequences only after one-turn approval, target revalidation, and Hyprland targeted backend checks. |
| `click`, `type`, `pointer`, `dispatch`, `clipboard`, `locked-use` | Always rejected as outside the current capability. |

## Capture Scopes

| Scope | Backend Behavior | Guardrail |
| --- | --- | --- |
| `active-window` | Uses `grim -T <toplevel-id>` with the active window `stableId` or Hyprland address fallback. | Requires an active target resolved from Hyprland IPC. |
| `monitor` | Uses monitor geometry from Hyprland state with `grim -g`. | Requires an explicit monitor name or ID. |
| `region` | Uses explicit `{ x, y, width, height }` geometry with `grim -g`. | Rejects non-interactive region capture without geometry. |
| `full` | Uses `grim <path>`. | Requires `allowFullDesktop: true`. |

## Evidence

Evidence records are written under `${XDG_RUNTIME_DIR}/hypr-computer-use/evidence` by default, or `evidenceDir` when supplied. Capture files are written under `${XDG_RUNTIME_DIR}/hypr-computer-use/captures` by default, or `outputPath` when supplied.

Evidence records include metadata such as operation, timestamp, target identity, capture scope, backend, and screenshot path. They do not inline image bytes and do not read or record clipboard contents.

## Safety Boundary

The visibility modes do not perform GUI actions. Guarded keyboard is the only current side-effecting mode, and it is limited to explicit keys/chords/sequences for one approved target. The plugin does not click, type free-form text, read or write the clipboard, install packages, use privileged helpers, or interact with the lockscreen. Future side-effecting features must verify the active target against this snapshot layer before acting.
