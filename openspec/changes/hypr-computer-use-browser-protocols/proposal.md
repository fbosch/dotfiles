## Why

Browser target discovery currently reports CDP and WebDriver BiDi as `unknown`. For Zen Browser, that is too vague: Zen is Firefox-based, current Firefox removed CDP, and WebDriver BiDi is the correct structured-control protocol when an explicit endpoint is enabled.

## What Changes

- Add browser family inference for discovered browser identities.
- Report protocol support separately from endpoint availability.
- Mark Zen/Firefox-family CDP as unsupported and WebDriver BiDi as supported but endpoint-dependent.
- Add safe optional WebDriver BiDi endpoint probing for configured loopback endpoints using `session.status` only.
- Keep browser launch, profile mutation, remote-debugging flag injection, session creation, tab enumeration, cookie/storage inspection, and DOM automation out of scope.
- Delegate browser interaction to existing browser automation tools such as `agent-browser` or `chrome-devtools` rather than implementing browser control in this plugin.

## Capabilities

### New Capabilities

- `hypr-computer-use-browser-protocols`: Browser family inference, structured-control protocol support reporting, and safe optional WebDriver BiDi endpoint probing.

### Modified Capabilities

- None.

## Impact

- Extends `.config/opencode/plugins/hypr-computer-use/` browser capability reporting.
- Extends browser target modes to include richer protocol status metadata.
- May use local WebSocket support for explicitly configured loopback BiDi endpoints.
- Does not add browser automation dependencies, launch browsers, or mutate browser profiles.
- Does not replace existing browser automation tools; it only reports whether a discovered browser target appears suitable for them.
