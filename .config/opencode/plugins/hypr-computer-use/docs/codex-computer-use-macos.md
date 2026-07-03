# Codex Computer Use on macOS

Codex Computer Use lets Codex operate desktop apps through the GUI: seeing, clicking, typing, navigating, and using app windows. It is meant for tasks where command-line tools, file inspection, plugins, or MCP integrations are not enough.

## Scope

| Feature | Capability | Restrictions / Notes |
| --- | --- | --- |
| GUI operation | Codex can operate normal desktop app interfaces. | It affects real app and system state outside the project workspace. Keep tasks scoped. |
| Visual context | Codex can inspect visible app UI, browser pages, dialogs, screenshots, and window state. | Treat visible app content as context Codex may process. Close sensitive apps unless needed. |
| Input control | Codex can click, type, navigate menus, use keyboard input, and interact with windows. | It cannot bypass Codex security controls or restricted OS prompts. |
| App workflows | Codex can complete tasks across apps, windows, browser sessions, and local files. | Prefer one clear target app or flow at a time. |
| Structured fallback | Codex can use Computer Use when a task has no good plugin, MCP, shell, or file-based route. | Prefer structured integrations when available because they are more deterministic and repeatable. |

## Availability

| Feature | Capability | Restrictions / Notes |
| --- | --- | --- |
| macOS support | Computer Use is available in supported regions for the Codex desktop app on macOS. | Regional availability varies by account and location. |
| Codex app support | Configured from the Codex desktop app settings. | This is not just a CLI feature. |
| Computer Use plugin | Installed from `Codex settings > Computer Use > Install`. | Codex cannot operate desktop apps through Computer Use until the plugin is installed. |
| Windows support | Also available on Windows. | Windows behavior differs: it runs on the active foreground desktop. macOS supports background and locked-use flows. |

## macOS Permissions and Approvals

| Permission / Approval | Capability | Restrictions / Notes |
| --- | --- | --- |
| Screen Recording | Lets Codex see the target app. | Granted in macOS Privacy & Security settings. Without it, Codex may not see the app. |
| Accessibility | Lets Codex click, type, and navigate. | Granted in macOS Privacy & Security settings. Without it, Codex may not control the app. |
| App approvals | Lets Codex use specific approved apps. | Separate from macOS permissions. OS permissions provide capability; app approvals decide which apps Codex may use. |
| Per-app prompts | Codex asks before using an app. | You must approve app access unless it was previously allowed. |
| `Always allow` | Lets Codex use a trusted app in future tasks without prompting each time. | Use sparingly. Remove entries later from Computer Use settings if needed. |
| Sensitive-action prompts | Codex may ask before taking sensitive or disruptive actions. | This is separate from OS-level Screen Recording and Accessibility permissions. |

## Core GUI Capabilities

| Feature | Capability | Restrictions / Notes |
| --- | --- | --- |
| Visual inspection | Codex can view app UI, screen content, browser pages, dialogs, visual states, and screenshots. | Anything visible in allowed target apps may become task context. |
| Screenshots | Codex can take screenshots while operating target apps. | Screenshots are covered by ChatGPT/Codex data controls. |
| Clicking | Codex can click buttons, links, menus, controls, and windows. | Clicks can trigger real app or account actions. |
| Typing | Codex can enter text into fields, documents, forms, chats, browser pages, and app dialogs. | Signed-in apps may treat the action as coming from your account. |
| Keyboard navigation | Codex can use keyboard input and shortcuts where needed. | It cannot automate terminal apps or Codex itself. |
| Menu navigation | Codex can navigate app menus and settings UIs. | Useful for app settings that are not file-backed or easy to change directly. |
| Window interaction | Codex can interact with app windows. | Stop the task if it targets the wrong window. |
| Clipboard state | Codex can interact with clipboard state in the target app. | Clipboard contents may be sensitive. Clear sensitive clipboard data before broad tasks. |

## Starting a Task

| Feature | Capability | Restrictions / Notes |
| --- | --- | --- |
| `@Computer` | Starts a Computer Use task. | Prompt should name the app, window, or flow Codex should operate. |
| App mentions | You can mention a specific app, such as `@Chrome`, `@Slack`, or `@Messages`. | If a dedicated plugin exists, Codex may prefer that plugin over raw Computer Use. |
| Natural language | You can ask Codex to use Computer Use or open an app with Computer Use. | Ambiguous prompts increase wrong-window and wrong-state risk. |
| Follow-up in thread | You can keep the same thread open to summarize, verify, or continue the workflow. | Keeping context in one thread helps Codex understand prior observations and changes. |

## App and Workflow Coverage

| Use Case | Capability | Restrictions / Notes |
| --- | --- | --- |
| Desktop app testing | Can test macOS apps, Windows apps, iOS simulator flows, and other desktop apps. | For locally built web apps, use the Codex in-app browser first when it is sufficient. |
| Browser tasks | Can use a browser to navigate pages, test flows, submit forms, inspect UI, or gather information. | Browser pages may contain malicious or misleading content. Treat approved clicks as your own. |
| GUI-only bug reproduction | Can reproduce bugs that only appear through graphical interaction. | Reliability depends on stable, visible UI state. |
| App settings changes | Can click through app settings and preferences. | Stay present for account, security, privacy, network, payment, or credential-related settings. |
| Data sources without plugins | Can inspect data in apps that do not expose a plugin, API, or MCP server. | Prefer structured integrations where available. |
| Multi-app workflows | Can move across apps, windows, browser sessions, and local files. | Avoid broad open-ended tasks. Give one clear flow. |
| Knowledge-work tasks | Can collect notes, update systems of record, copy details between apps, and draft replies after checking context. | Private messages, notes, and files used in the task become visible context. |
| Local-file workflows through apps | Can work with local files as opened through approved desktop apps. | GUI changes may not appear in Codex review until saved to disk and tracked. |

## Browser Behavior

| Feature | Capability | Restrictions / Notes |
| --- | --- | --- |
| Browser selection | You can tell Codex which browser to use. | Use a separate browser if you want to keep working in your main browser. |
| Default browser preference | You can customize Codex to prefer a browser for Computer Use web tasks. | This is a Codex customization, not a macOS system default. |
| Signed-in sessions | Codex can interact with pages where you are already signed in. | Sites may treat submissions, clicks, and changes as coming from your account. |
| Browser isolation by convention | Assigning Codex a different browser reduces interference. | This is not a hard security boundary. |
| Local web app testing | Codex can test browser flows visually. | Use the in-app browser first for local web apps when possible. |

## Background Use on macOS

| Feature | Capability | Restrictions / Notes |
| --- | --- | --- |
| Background operation | Codex can run scoped Computer Use tasks while you keep working elsewhere. | Avoid using the same app/window Codex is operating. |
| Parallel agents | Multiple Codex agents can work on Mac in parallel. | Do not run two Computer Use tasks against the same app at once. |
| Own interaction channel | Codex can operate apps without taking over your entire session in the same way foreground automation does. | It still changes real app state. |

## Locked Computer Use on macOS

| Feature | Capability | Restrictions / Notes |
| --- | --- | --- |
| Locked use | Lets Codex use Computer Use after your Mac locks. | macOS only. Must be explicitly enabled. |
| Enablement | Enabled from `Codex settings > Computer Use`. | Not enabled by default. |
| Connected-device use | Intended for tasks sent from a connected device after the Mac screen locks. | Applies to active, trusted Computer Use turns. |
| Apple authorization plug-in | Codex installs an Apple authorization plug-in that participates in the unlock flow. | This is not a general remote-unlock feature. |
| Temporary unlock | Codex can temporarily unlock the Mac to operate approved apps. | Local use is blocked and locked-screen protections are preserved. |
| Short-lived authorization | Unlock authorization is scoped to the current unlock attempt. | Outside that window, Codex denies automatic unlock and requires manual unlock. |
| Codex-only unlock | Automatic unlock is available only to Codex during active Computer Use turns. | Other apps and local processes do not get unlock access. |
| Display covering | Codex covers every display while the desktop is temporarily unlocked. | Intended to preserve locked-screen privacy protections. |
| Local input detection | If Codex detects local keyboard or pointer input, it relocks the Mac and pauses automatic unlock. | Manual unlock is required after that. |
| Lock behavior without locked use | Computer Use activity may stop when the Mac locks. | Locked use changes this only after the feature is enabled. |

## Structured Integrations vs Computer Use

| Feature | Capability | Restrictions / Notes |
| --- | --- | --- |
| Plugin preference | Codex may prefer a dedicated plugin or MCP server when one exists. | Usually better for data access and repeatable operations. |
| Computer Use fallback | Codex can operate an app visually when no structured integration exists. | GUI automation is less deterministic than APIs or plugins. |
| Best use boundary | Computer Use is for visual/manual UI tasks. | Prefer shell, file access, plugins, MCP, or the in-app browser when they provide a cleaner route. |

## Security and Safety Restrictions

| Restriction | Meaning |
| --- | --- |
| Cannot automate terminal apps | Terminal automation is restricted because it could bypass Codex security policies. |
| Cannot automate Codex itself | Codex cannot use Computer Use to control the Codex app. |
| Cannot approve admin prompts | Codex cannot authenticate as an administrator or approve system security/privacy prompts. |
| Cannot bypass sandboxing | File edits and shell commands still follow Codex approval and sandbox settings. |
| Cannot freely use all apps | Codex can see and act only in apps you approve. |
| Cannot make GUI changes automatically reviewable | GUI changes may not appear in the review pane until saved to disk and tracked by the project. |
| Not a general remote unlock | Locked use is narrowly scoped to active trusted Computer Use turns. |
| Not a substitute for human judgment | Stay present for credentials, payments, privacy/security settings, account changes, and high-impact actions. |

## Operational Failure Modes

| Situation | Effect / Restriction |
| --- | --- |
| Missing Screen Recording permission | Codex may not see the target app. |
| Missing Accessibility permission | Codex may not click, type, or navigate. |
| Wrong app or window active | Codex may interact with the wrong state. Cancel if this happens. |
| Two tasks using the same app | Context and window state can become unstable. |
| User and Codex using the same app | Input and state can conflict. Use another browser/app/session where possible. |
| Sensitive apps open | Visible content may be processed. Close them unless needed. |
| Unsaved GUI changes | Review output may not show changes until the app saves them. |
| Web prompt injection | Sites can display misleading instructions. Treat Codex actions as signed-in user actions. |
| Locked Mac without locked use | Activity may stop when the Mac locks. |
| Locked Mac with locked use | Activity continues only under the locked-use safeguards. |

## Data and Privacy

| Area | Behavior / Restriction |
| --- | --- |
| Visible content | Visible app content, browser pages, screenshots, and files opened in target apps may be processed by Codex. |
| Screenshots | Computer Use may capture screenshots as part of operation. |
| Data controls | ChatGPT data controls apply to content processed through Codex, including screenshots. |
| Signed-in accounts | Codex can act through already-signed-in browser and app sessions. |
| Clipboard | Clipboard state can be used in the target app. |
| Secrets | Avoid tasks requiring secrets unless you are present and can approve or enter each step. |

## Recommended Usage Patterns

| Pattern | Why |
| --- | --- |
| Give one clear target app or flow | Reduces wrong-window and wrong-state risk. |
| Prefer plugins, MCP, shell, or files for structured work | More deterministic, auditable, and repeatable. |
| Use Computer Use for GUI-only gaps | Best fit is visual state, desktop testing, settings UIs, and app workflows without APIs. |
| Use a separate browser for Codex | Reduces interference with your own browser session. |
| Stay signed in before starting | Avoids authentication interruptions. |
| Avoid parallel tasks in the same app | Prevents context collisions. |
| Stay present for sensitive operations | High-impact operations need human oversight. |
| Review app permission prompts | App approvals determine what Codex can operate. |
| Use `Always allow` sparingly | It removes future prompts for that app. |
| Stop or take over when needed | You can interrupt a task if it goes off course. |

## Example Capability Map

| Task | Fit | Notes |
| --- | --- | --- |
| Open Chrome and verify checkout still works. | Good | Browser GUI flow. Use in-app browser first for local web apps when sufficient. |
| Reproduce the onboarding bug in my macOS app and fix the smallest code path. | Good | Strong fit for GUI reproduction plus code fix. |
| Change an app preference hidden in Settings. | Good | Strong fit when no config file or API is available. |
| Read my Messages thread, make a note, and draft a reply. | Good but sensitive | Private content becomes task context. Approve carefully. |
| Run `npm test` in Terminal by clicking around. | Poor / restricted | Use Codex shell tools instead. Terminal automation is restricted. |
| Approve macOS Security & Privacy prompts for itself. | Not supported | Admin/security prompt approval is restricted. |
| Use Codex to operate Codex. | Not supported | Automating Codex itself is restricted. |
| Modify repo files through a GUI editor. | Possible but usually poor | Shell and file tools are more reviewable. |
| Submit a payment in a signed-in browser. | High risk | Stay present and approve deliberately. |
| Continue a GUI task after the Mac locks. | Supported with locked use | macOS only, with locked-use safeguards enabled. |

## Sources

- `https://developers.openai.com/codex/app/computer-use`
- `https://developers.openai.com/codex/use-cases/use-your-computer-with-codex`
