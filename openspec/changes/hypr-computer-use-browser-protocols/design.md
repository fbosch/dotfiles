## Context

`hypr-computer-use-browser-targets` resolves the default browser, parses desktop entries, matches visible Hyprland browser windows, and reports conservative capability statuses. Research found that Zen Browser `1.21.5b` is Firefox-based and current Firefox removed CDP support. Firefox-family structured control now centers on WebDriver BiDi, with Marionette as a lower-level/legacy automation path.

The plugin should not infer a live automation endpoint from a visible browser window. Protocol support and endpoint availability are separate facts.

## Goals / Non-Goals

**Goals:**

- Infer browser family from browser identity metadata without hardcoding one browser instance.
- Report protocol support for CDP, WebDriver BiDi, and Marionette.
- For Zen/Firefox-family browsers, report CDP as unsupported and WebDriver BiDi as supported by browser but not configured unless an endpoint is supplied.
- Probe a configured WebDriver BiDi endpoint only when it is loopback-scoped.
- Use the non-invasive BiDi `session.status` command only.

**Non-Goals:**

- No broad port scanning.
- No default probing of common ports without configuration.
- No browser launch, URL opening, profile mutation, or remote-debugging flag injection.
- No BiDi `session.new`, page enumeration, cookie/storage access, network inspection, or DOM automation.
- No geckodriver or Marionette client implementation in this slice.

## Decisions

### Represent support and endpoint availability separately

The capability report will distinguish browser support from endpoint status. A browser can support WebDriver BiDi while no endpoint is available.

Alternatives considered:

- Keep a single string status: rejected because `unknown` hides useful Zen/Firefox facts and `available` would overclaim without an endpoint.

### Infer Firefox-family from identity metadata

Zen is inferred as Firefox-family from desktop ID, Flatpak ID, name, exec string, and class candidates. This avoids hardcoding only `app.zen_browser.zen` while still recognizing Firefox-derived browsers.

Alternatives considered:

- Require explicit browser family configuration: too much friction for the default browser case.
- Probe runtime protocols to infer family: unsafe and unnecessary for read-only metadata reporting.

### Probe only configured loopback WebDriver BiDi endpoints

Endpoint probing will accept only explicit WebSocket URLs with loopback hosts. It will send `session.status` and treat success as endpoint availability.

Alternatives considered:

- Scan localhost ports: rejected as noisy and potentially invasive.
- Create a WebDriver BiDi session: rejected because detection should not mutate browser automation state.

## Risks / Trade-offs

- Browser family inference can be wrong for obscure forks -> Return `unknown` when metadata does not match known families.
- Configured endpoint can expose sensitive browser control -> Restrict probes to loopback and use `session.status` only.
- WebSocket support differs by runtime -> Fail closed to endpoint `unreachable` instead of weakening protocol reporting.
- CDP support for old Firefox ESR exists historically -> Current Zen/Firefox-family inference targets modern Firefox-based browsers and reports CDP unsupported for this environment.

## Migration Plan

This is additive. Existing browser target modes remain available and return richer capability metadata.

Rollback is removing the protocol inference/probe code and reverting capability fields to the earlier conservative statuses.

## Open Questions

- Should later configuration support named endpoints per browser identity?
- Should Chromium-family CDP endpoint probing be added as a separate capability after target policy exists?
