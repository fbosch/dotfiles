# Read-Only Visibility Boundary

The first `hypr-computer-use` slice exposes desktop visibility only. It can identify Hyprland state, create active-target snapshots, capture scoped screenshots, and write metadata-first evidence records.

## Exposed Tool

| Tool | Purpose |
| --- | --- |
| `hypr_computer_use_readonly` | Read Hyprland state, create target snapshots, capture scoped screenshots, and reject side-effecting computer-use requests. |

## Modes

| Mode | Behavior |
| --- | --- |
| `state` | Returns monitors, workspaces, clients, active-window metadata, and a metadata evidence record. |
| `snapshot` | Returns the normalized active-target snapshot or `null` when no active target exists. |
| `capture` | Captures an explicit screenshot scope and records screenshot metadata. |
| `click`, `type`, `pointer`, `keyboard`, `dispatch`, `clipboard`, `locked-use` | Always rejected as outside the read-only capability. |

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

This slice does not perform GUI actions. It does not call Hyprland dispatchers, inject input, read or write the clipboard, install packages, use privileged helpers, or interact with the lockscreen. Future side-effecting features must verify the active target against this read-only snapshot layer before acting.
