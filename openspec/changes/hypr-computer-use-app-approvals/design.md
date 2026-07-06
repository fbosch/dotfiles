## Context

The plugin already exposes Hyprland state and target metadata. The planned action router will classify requests and select safe routes, but desktop-level routes still need an app approval decision before any future executor can act.

macOS Computer Use separates OS-level capability from app approvals. The Hyprland equivalent should not try to copy macOS permissions. It should use compositor-observed app/window identity and produce explicit allow/ask/deny decisions that the route layer can enforce.

## Goals / Non-Goals

**Goals:**

- Define app identity fields used for approvals.
- Classify app targets into `approved`, `ask`, `denied`, or `sensitive`.
- Produce prompt decisions that include enough app/window metadata for a human to approve or reject knowingly.
- Deny known unsafe target classes by default.
- Keep the first slice read-only and testable.

**Non-Goals:**

- Do not implement click, type, keyboard, pointer, clipboard, or Hyprland dispatch execution.
- Do not add broad persistent `Always allow` behavior in the first slice.
- Do not use app approvals to bypass OpenCode shell/file permissions.
- Do not approve privileged prompts, browser permission prompts, terminal GUI automation, OpenCode/Codex windows, or locked sessions.
- Do not treat app approval as consent for every action in that app; sensitive actions still require separate gates.

## Decisions

### Approval state is separate from route selection

The route layer decides the best path. The approval layer decides whether the resolved app/window target is allowed, denied, sensitive, or requires a prompt. This keeps app policy reusable across future Hyprland-native actions, visual inspection, and possible app-specific integrations.

Alternative considered: merge approvals directly into request classification. That makes policy harder to test and risks approving a route without binding the decision to a concrete target.

### Default unknown apps to ask

Unknown normal apps should not be denied by default, because the purpose of Computer Use is to cover app workflows that lack structured integrations. They should produce `ask` with concrete target metadata. Known unsafe or sensitive targets still deny or classify as `sensitive`.

Alternative considered: deny all unknown apps. That is safer but makes the feature mostly unusable without first building a large app registry.

### Match narrow identities first

Approval matching should prefer stable, narrow identifiers: desktop ID when available, Flatpak ID when available, then Hyprland class and process metadata. Title matching should be used for sensitivity detection and disambiguation, not broad allow rules.

Alternative considered: class-only matching. That is easy but too broad for Electron apps, browser windows, and renamed launchers.

### Persistent approval storage is deferred

The first implementation should return prompt decisions and policy outcomes. If persistent approvals are added later, they should be explicit, revocable, and narrow. This avoids accidentally creating a broad `Always allow` store before the matching model is proven.

Alternative considered: add a TOML allowlist immediately. That adds config format and migration surface before the route and policy decisions have been exercised.

### Sensitive is not approved

`sensitive` is a separate state from `ask`. It means the target or action category needs a stronger gate or human handling. Privileged prompts and locked sessions remain denied, not sensitive.

Alternative considered: collapse sensitive into ask. That makes payment, credential, account, privacy, and security prompts look like ordinary app access prompts.

## Risks / Trade-offs

- False positives in sensitive detection → Keep default action conservative and include matched signals in evidence.
- False negatives in app identity matching → Prefer `ask` over `approved` when confidence is low.
- Prompt fatigue → Keep prompt text concise and include only actionable metadata.
- Broad future allow rules → Require narrow identifiers and do not add persistence in this slice.
- Browser windows blur app and content approval → App approval can approve the browser app target, but browser/page actions still route to dedicated browser tools and sensitive site actions require separate gates.
