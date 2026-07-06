# Hyprland Computer Use Feasibility

This ranks how realistic it is to recreate Codex Computer Use-style features on Linux with Hyprland. The main constraint is Wayland's security model: compositors intentionally avoid global screen capture and input injection APIs unless the compositor, portal, or a privileged helper explicitly allows them.

## Ranking Scale

| Rank | Meaning | Practical Interpretation |
| --- | --- | --- |
| 5 | Straightforward | Can be built with existing Hyprland IPC, portals, shell tools, or app-specific automation. Low security friction. |
| 4 | Feasible | Buildable with a small helper service and clear user approval model. Some compositor/app edge cases. |
| 3 | Feasible but brittle | Works for scoped flows, but depends on app behavior, focus state, screenshots, OCR, or heuristic UI targeting. |
| 2 | Hard / partial | Possible only with privileged components, compositor cooperation, wlroots protocols, or degraded behavior. |
| 1 | Poor fit | Recreating it would fight Wayland security boundaries or create unsafe bypasses. Prefer another route. |

## Overall Assessment

| Area | Rank | Assessment |
| --- | --- | --- |
| Screen/window visibility | 4 | Hyprland can expose monitor/window state through IPC, and screenshots are available through portal/grim-style tools. Precise per-app visual context needs approval and careful capture boundaries. |
| Input control | 2 | Wayland blocks generic global input injection. Guarded keyboard now covers a narrow Hyprland-targeted slice for explicit keys/chords/sequences; arbitrary click/text automation still needs compositor support, virtual input protocols, app APIs, or a privileged helper. |
| Browser automation | 5 | Best target. Use Chrome DevTools Protocol, Playwright, browser profiles, or extension APIs instead of pixel automation. |
| Native app automation | 3 | Feasible for apps with CLIs, DBus, portals, accessibility APIs, or predictable UI. Brittle for generic GTK/Qt/Electron apps without automation hooks. |
| Background operation | 3 | Hyprland workspaces and window rules can isolate tasks, but true non-interference depends on avoiding global focus/input conflicts. Browser/API automation is much safer than GUI input. |
| Locked-session operation | 1 | Unsafe and poorly aligned with Linux lockscreen/compositor boundaries. Do not recreate macOS-style temporary unlock unless implemented by the compositor/locker with explicit security design. |
| Approval and policy model | 4 | App allow/deny policy is straightforward at the agent/plugin level. Enforcing it for all GUI side effects is harder without compositor-level mediation. |

## Feature Matrix

| Codex Feature | Hyprland Feasibility | Rank | Likely Linux/Hyprland Primitives | Main Restrictions | Implementation Note |
| --- | --- | ---: | --- | --- | --- |
| GUI operation | Partial | 3 | Hyprland IPC, window focus dispatchers, screenshots, app-specific APIs, browser automation | Generic click/type control is the hard part under Wayland. | Treat GUI operation as a routing layer: prefer app APIs, browser protocols, and compositor commands before pixel input. |
| Visual context | Feasible | 4 | `hyprctl clients -j`, `hyprctl monitors -j`, xdg-desktop-portal screencast/screenshot, grim/slurp, OCR/vision model | Screenshots require user-approved capture paths or compositor-permitted tools. Per-window capture may be inconsistent. | Build explicit capture scopes: active window, selected region, monitor, or browser screenshot. |
| Input control | Hard / partial | 2 | Hyprland dispatch commands, virtual keyboard/pointer protocols, ydotool/uinput, app APIs | Wayland intentionally prevents untrusted global input injection. Privileged uinput helpers are security-sensitive. | Avoid global synthetic input as the default. Use it only behind explicit permission and narrow app/workspace targeting. |
| App workflows | Feasible but mixed | 3 | Shell tools, DBus, browser automation, file APIs, app CLIs, clipboard tools, Hyprland IPC | Multi-app pixel workflows are fragile when focus, window position, or UI state changes. | Model workflows as tool/API steps first, with GUI fallback only for the missing step. |
| Structured fallback | Straightforward | 5 | Tool router, app capability registry, MCP/plugins, shell commands | Requires maintaining app capability metadata. | This should be the default architecture: structured integration first, GUI only as escape hatch. |
| macOS support equivalent | Not applicable | 1 | N/A | This is platform-specific. | Replace with Linux/Hyprland capability detection. |
| Codex app support equivalent | Feasible | 4 | OpenCode plugin, local helper daemon, config files, permission prompts | OpenCode plugin APIs may not provide native GUI approval UI. | A plugin can document and orchestrate helpers, but privileged operations should live outside the plugin. |
| Computer Use plugin install | Feasible | 4 | OpenCode plugin package, local scripts, health checks | Installing OS permissions and helper binaries is distro-specific. | Keep install explicit and inspectable. Dotfiles should not silently add privileged services. |
| Windows support equivalent | Not applicable | 1 | N/A | Out of scope for Hyprland. | Document as unsupported rather than abstracting prematurely. |
| Screen Recording permission | Feasible equivalent | 4 | xdg-desktop-portal, compositor screenshot tools, explicit user selection | Linux has no single macOS-style Screen Recording permission. Portal UX differs by desktop/compositor. | Use portal-backed capture when possible; fall back to Hyprland/grim only when user configured it. |
| Accessibility permission | Hard equivalent | 2 | AT-SPI, DBus, virtual input, app automation APIs | Linux accessibility does not provide universal safe app control equivalent to macOS Accessibility. Wayland input remains restricted. | Separate accessibility tree inspection from input injection. Do not assume AT-SPI can operate every app. |
| App approvals | Feasible | 4 | Plugin policy file, executable/window class allowlist, Hyprland window metadata | Enforcement is only as strong as the tool path. Pixel input helpers can still affect the wrong app if focus changes. | Use app identifiers from Hyprland class/title/process metadata and require current-window checks before actions. |
| Per-app prompts | Feasible | 4 | OpenCode permission prompts, local policy store, helper confirmation | Prompting is easy; reliable binding to the exact app/window is harder. | Include window class, title, PID when asking for approval. |
| `Always allow` | Feasible | 4 | Local TOML/JSON policy store | Persistent allow rules can become stale if app IDs are broad. | Store narrow identifiers and allow revocation. Avoid broad rules like all browsers. |
| Sensitive-action prompts | Feasible but semantic | 3 | Agent policy, URL/action classifiers, app-specific hooks | Detecting sensitive actions from screenshots is unreliable. | Use structured hooks for known apps/sites; otherwise ask before form submit, payment, credential, account, or security-setting steps. |
| Visual inspection | Feasible | 4 | Screenshot tools, portals, OCR, vision model, Hyprland IPC | OCR/vision can misread UI. Hidden windows and occluded content are not reliable unless captured directly. | Pair image capture with compositor metadata. Never infer active app from screenshot alone. |
| Screenshots | Straightforward | 5 | grim, slurp, hyprshot, portal screenshot API, browser CDP screenshots | Capturing without user consent can be sensitive. Tool availability varies by system. | Support monitor, region, active-window, and browser modes. Prefer explicit target selection. |
| Clicking | Hard / partial | 2 | Hyprland focus dispatchers, virtual pointer protocols, ydotool/uinput | Generic click injection is restricted and can hit the wrong app. | Prefer app APIs. If used, require current-window verification immediately before click. |
| Typing | Hard / partial | 2 | virtual keyboard protocol, ydotool/uinput, clipboard paste, app APIs | Generic typing has the same focus and privilege problems as clicking. Clipboard paste leaks state. | Prefer structured text insertion APIs. Clipboard-based paste needs save/restore and explicit permission. |
| Keyboard navigation | Hard / partial | 2 | Hyprland targeted dispatch, virtual keyboard, app shortcuts, DBus | Guarded explicit keys can target one approved window without requiring active focus, but arbitrary text entry and XWayland edge cases remain unsafe. | Keep app keystrokes approval-gated, target-revalidated, and evidence-backed. |
| Menu navigation | Brittle | 3 | App shortcuts, DBus menus, AT-SPI, screenshots/OCR | Many apps expose menus differently. Pixel navigation breaks with theme/layout changes. | Use DBus/app APIs for known apps; avoid generic menu-walking unless supervised. |
| Window interaction | Feasible | 4 | Hyprland dispatchers, `hyprctl clients -j`, workspace/window rules | Window movement/focus is compositor-safe; app internals are not. | This is one of the best Hyprland-native capabilities. Build it around client addresses and workspace IDs. |
| Clipboard state | Feasible | 4 | wl-clipboard, cliphist, app APIs | Clipboard may contain secrets. Clipboard managers can persist sensitive data. | Require explicit permission for read/write. Save/restore only when safe, and avoid logging clipboard contents. |
| `@Computer` task start | Straightforward | 5 | OpenCode command/plugin prompt conventions | Naming is UX only. | Implement as a command or documented prompt pattern. |
| App mentions | Feasible | 4 | App registry, desktop files, Hyprland class matching, command launchers | App names do not always map cleanly to window classes or executable names. | Maintain a small app registry with class, command, automation method, and risk level. |
| Natural-language request | Straightforward | 5 | Agent prompting and tool routing | Ambiguity creates unsafe GUI actions. | Require the planner to resolve target app/window before acting. |
| Follow-up in thread | Straightforward | 5 | OpenCode conversation context, local logs, task state files | Long-running GUI state may drift from conversation state. | Store concise observations: app, window ID, screenshot path, action taken, verification result. |
| Desktop app testing | Feasible but app-dependent | 3 | Hyprland window rules, app CLIs, screenshots, accessibility, test harnesses | Generic visual testing is brittle. Native app test hooks are better. | For apps you build, add deterministic test hooks before adding pixel automation. |
| Browser tasks | Straightforward | 5 | Chrome DevTools Protocol, Playwright, WebDriver BiDi, browser profiles | Some sites block automation or require human auth. | Use browser automation first; Computer Use-style screenshots only for visual verification. |
| GUI-only bug reproduction | Feasible | 4 | Screenshots, app logs, browser/devtools, compositor metadata, repro scripts | Input automation may be partial. | Good fit when paired with manual reproduction prompts or app-specific test harnesses. |
| App settings changes | Feasible but risky | 3 | App CLIs, config files, DBus, screenshots, input fallback | Security/account/network settings need human review. GUI paths change across versions. | Prefer editing config files or app APIs. Use GUI fallback only when no stable backend exists. |
| Data sources without plugins | Feasible but brittle | 3 | Screenshots/OCR, clipboard, export flows, app-specific scraping | Visual extraction is error-prone and may expose sensitive content. | Prefer export/API/DBus. Use OCR only for low-stakes read-only extraction. |
| Multi-app workflows | Feasible with orchestration | 3 | Tool router, browser automation, Hyprland IPC, clipboard, app CLIs | Focus and clipboard conflicts are common. | Make each app step explicit and verify state between steps. |
| Knowledge-work tasks | Feasible but sensitive | 3 | Browser automation, app APIs, screenshots, clipboard | Messages, notes, mail, and calendars contain private data and account actions. | Use read-only modes where possible and ask before sending/posting/deleting. |
| Local-file workflows through apps | Feasible | 4 | File tools, app CLIs, xdg-open, window rules, screenshots | GUI edits are less reviewable than direct file edits. | Use file tools for edits; use GUI only to preview or verify rendered output. |
| Browser selection | Straightforward | 5 | Browser profiles, launch commands, desktop files | Browser naming/profile state must be explicit. | Create a dedicated automation profile/browser to avoid touching the user's main session. |
| Default browser preference | Straightforward | 5 | OpenCode config, plugin config, app registry | Preference must not override explicit user prompt. | Store per-task default, not global OS default. |
| Signed-in sessions | Feasible but high-risk | 3 | Existing browser profiles, cookies, app sessions | Actions are from the user's account. Prompt injection risk is real. | Prefer a dedicated profile with only required accounts. Ask before irreversible actions. |
| Browser isolation by convention | Straightforward | 5 | Separate browser profile, separate browser app, workspaces/window rules | Not a hard security boundary. | Combine with workspace isolation and explicit profile naming. |
| Local web app testing | Straightforward | 5 | Playwright, CDP, screenshots, local server checks | GUI-only visual assertions still need screenshots. | Use Playwright/CDP as primary; Hyprland screenshots as secondary evidence. |
| Background operation | Partial | 3 | Dedicated workspace, window rules, browser automation, app APIs | True GUI input still usually needs focus or privileged virtual input. | Background work should be API/browser-driven. Avoid focused desktop input where possible. |
| Parallel agents | Feasible with isolation | 3 | Separate browser profiles, separate workspaces, per-task directories | Agents conflict if they share apps, accounts, clipboard, or display focus. | Allow parallelism only across isolated profiles/apps/workspaces. |
| Own interaction channel | Hard | 2 | Browser CDP, virtual input, nested compositor, VM, containerized desktop | Wayland apps do not generally expose independent per-agent input channels. | A nested compositor or VM is cleaner than injecting into the user's main session. |
| Locked use | Poor fit | 1 | Locker integration would be required | Recreating temporary unlock is security-sensitive and compositor/locker-specific. | Do not implement in a dotfiles/plugin layer. Use remote/API tasks instead. |
| Locked-use enablement | Poor fit | 1 | Locker/compositor configuration | Enabling this safely is outside a normal plugin's authority. | Document as intentionally unsupported unless Hyprland/locker grows a first-class protocol. |
| Connected-device locked use | Poor fit | 1 | Remote control service plus locker integration | Remote unlock/control expands attack surface. | Prefer remote task submission that avoids GUI and runs in sandboxed tools. |
| Authorization plug-in equivalent | Poor fit | 1 | PAM/locker/compositor hooks | Linux equivalents are fragmented and high-risk. | Avoid custom PAM/locker bypasses. |
| Temporary unlock | Poor fit | 1 | Locker/compositor cooperation | Unsafe without first-class compositor design. | Do not recreate. |
| Short-lived authorization | Poor fit | 1 | Security daemon, locker hooks | The hard part is proving the active trusted turn. | Not suitable for a small OpenCode/Hyprland plugin. |
| Codex-only unlock equivalent | Poor fit | 1 | Privileged identity and policy system | Difficult to enforce safely across local processes. | Not worth building outside compositor/locker upstream. |
| Display covering | Hard | 2 | Layer-shell overlay, locker cooperation | Covering displays while unlocked is not enough if local processes can observe/input. | Only meaningful as part of a complete lockscreen design. |
| Local input detection | Feasible component | 3 | libinput, compositor events, idle/inhibit signals | Detection alone does not make temporary unlock safe. | Useful for pausing automation, not for authorizing locked-session control. |
| Lock behavior without locked use | Straightforward | 5 | Detect lock/session idle, pause tasks | Pausing is safer than unlocking. | Implement pause-on-lock as the default policy. |
| Plugin preference | Straightforward | 5 | Tool router, app registry, MCP/plugin metadata | Requires capability registry maintenance. | Always route to structured integration before GUI fallback. |
| Computer Use fallback | Feasible | 4 | Tool router plus screenshots/input/app APIs | Fallback quality depends on target app. | Make fallback explicit and logged. |
| Best use boundary | Straightforward | 5 | Policy docs, planner prompt, guardrails | Enforcement depends on tool design. | Encode this as policy: structured route first, visual fallback last. |
| Cannot automate terminal apps | Should preserve | 5 | Policy denylist | Users can still use shell tools through normal OpenCode permissions. | Keep terminal GUI automation denied; use shell tools with approvals instead. |
| Cannot automate Codex itself | Should preserve | 5 | Policy denylist | Prevents control-loop and approval-bypass bugs. | Deny OpenCode/Codex windows as GUI targets. |
| Cannot approve admin prompts | Should preserve | 5 | Policy denylist, no pkexec/sudo GUI automation | Privileged prompts must remain human actions. | Never automate Polkit, sudo password dialogs, keychain prompts, or permission dialogs. |
| Cannot bypass sandboxing | Should preserve | 5 | OpenCode permissions, helper policy, no hidden privileged path | Privileged helpers can accidentally bypass this. | Helpers must not provide file/shell powers outside existing approval paths. |
| Cannot freely use all apps | Feasible | 4 | App allowlist/denylist, current-window checks | Strong enforcement needs all action paths to consult policy. | Put policy in the lowest-level helper, not only in the agent prompt. |
| Cannot make GUI changes automatically reviewable | Same limitation | 5 | Git status, file watchers, app save detection | GUI edits remain opaque until saved. | Prefer direct file edits. Use git/file checks after GUI operations. |
| Not a general remote unlock | Should preserve | 5 | Policy and architecture choice | Avoiding unlock is the point. | Design around pause-on-lock and remote non-GUI execution. |
| Not a substitute for human judgment | Should preserve | 5 | Prompts, sensitive-action gates, logs | Classification is imperfect. | Ask before irreversible account, payment, credential, privacy, or security changes. |

## Recommended Architecture

| Layer | Feasibility | Role |
| --- | --- | --- |
| App capability registry | 5 | Maps app names to launch commands, window classes, automation methods, risk level, and allowed actions. |
| Hyprland state adapter | 5 | Reads monitors, workspaces, active window, clients, fullscreen state, and window addresses through Hyprland IPC. |
| Capture adapter | 4 | Provides browser screenshots, active-window screenshots, region screenshots, and monitor screenshots through approved tools. |
| Browser automation adapter | 5 | Uses CDP/Playwright/WebDriver for web tasks instead of pixel control. |
| Clipboard adapter | 4 | Reads/writes clipboard only with explicit policy and redaction rules. |
| Input adapter | 2 | Optional, high-risk layer for virtual input. Disabled by default and guarded by app/window checks. |
| Policy engine | 4 | Enforces app allow/deny rules, sensitive action gates, and current-window verification. |
| Task log | 5 | Records target app, window metadata, screenshot paths, actions, approvals, and verification. |
| Lock/session monitor | 4 | Pauses GUI automation when the session locks or local user activity conflicts. |

## Build Order

| Phase | Scope | Why First |
| --- | --- | --- |
| 1 | Hyprland state adapter plus screenshot capture | Gives safe read-only visibility with low risk. |
| 2 | Browser automation and dedicated browser profile | Covers the highest-value workflows without fighting Wayland input restrictions. |
| 3 | App registry and approval policy | Makes targeting explicit before adding side-effecting actions. |
| 4 | Clipboard and file handoff workflows | Useful for app workflows, but needs secret handling and logging discipline. |
| 5 | App-specific automation for known apps | Better than generic pixel control and easier to test. |
| 6 | Guarded keyboard through Hyprland targeted dispatch | First narrow input-control slice: explicit keys/chords/sequences, one-turn approval, target revalidation, and before/after evidence. |
| 7 | Optional virtual input helper | Only after policy, targeting, and logging exist. Keep disabled by default. |
| Never by default | Locked-session temporary unlock | Too much security surface for a plugin/dotfiles layer. |

## Practical Takeaway

The feasible Hyprland version should not copy macOS Computer Use literally. The strong path is a hybrid system: Hyprland IPC for window state, approved screenshots for visual context, browser/app APIs for actions, and very limited input injection as a last resort. Locked-session control and broad synthetic input are the weak assumptions; they should stay out of scope unless Hyprland, the locker, and the permission model provide first-class support.
