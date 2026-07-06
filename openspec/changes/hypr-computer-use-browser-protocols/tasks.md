## 1. Protocol Contracts

- [x] 1.1 Add browser family and protocol capability types.
- [x] 1.2 Add optional WebDriver BiDi endpoint input to the read-only tool args.

## 2. Browser Family and Support Inference

- [x] 2.1 Infer `firefox-gecko` for Zen and Firefox-family identities.
- [x] 2.2 Report CDP unsupported and WebDriver BiDi/Marionette supported for Firefox-family browsers.
- [x] 2.3 Preserve unknown protocol statuses for unrecognized browser families.

## 3. WebDriver BiDi Endpoint Probe

- [x] 3.1 Validate configured endpoint URLs as loopback-only WebSocket URLs.
- [x] 3.2 Probe WebDriver BiDi with `session.status` only.
- [x] 3.3 Report endpoint statuses `notConfigured`, `available`, `unreachable`, or `rejected`.

## 4. Tests and Docs

- [x] 4.1 Add tests for Zen/Firefox-family protocol inference.
- [x] 4.2 Add tests for loopback rejection and BiDi endpoint probe results.
- [x] 4.3 Update browser target docs with protocol support and safety boundaries.
- [x] 4.4 Run focused tests, typechecks, and a live smoke check.
