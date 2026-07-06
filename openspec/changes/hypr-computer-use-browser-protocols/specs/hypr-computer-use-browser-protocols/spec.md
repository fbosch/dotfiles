## ADDED Requirements

### Requirement: Browser family is inferred conservatively
The system SHALL infer browser family from normalized browser identity metadata without launching or probing the browser.

#### Scenario: Zen browser identity is detected
- **WHEN** the browser identity contains Zen Browser metadata or `app.zen_browser.zen`
- **THEN** the system reports browser family `firefox-gecko`

#### Scenario: Firefox browser identity is detected
- **WHEN** the browser identity contains Firefox-family metadata
- **THEN** the system reports browser family `firefox-gecko`

#### Scenario: Browser family is not recognized
- **WHEN** browser identity metadata does not match a known family
- **THEN** the system reports browser family `unknown`

### Requirement: Protocol support is separate from endpoint availability
The system SHALL report structured browser control support separately from live endpoint status.

#### Scenario: Firefox-family browser is detected
- **WHEN** browser family is `firefox-gecko`
- **THEN** CDP support is reported as `unsupported`
- **AND** WebDriver BiDi support is reported as `supported`
- **AND** Marionette support is reported as `supported`

#### Scenario: Unknown browser family is detected
- **WHEN** browser family is `unknown`
- **THEN** CDP, WebDriver BiDi, and Marionette support are reported as `unknown`

#### Scenario: No structured endpoint is configured
- **WHEN** no WebDriver BiDi endpoint is supplied
- **THEN** WebDriver BiDi endpoint status is reported as `notConfigured`
- **AND** the system does not probe localhost ports

### Requirement: WebDriver BiDi endpoint probing is explicit and loopback-only
The system SHALL probe WebDriver BiDi only for explicitly supplied loopback WebSocket endpoints.

#### Scenario: Configured endpoint is loopback
- **WHEN** a WebDriver BiDi endpoint URL uses `ws:` or `wss:` and host `127.0.0.1`, `::1`, or `localhost`
- **THEN** the system may attempt a non-invasive endpoint probe

#### Scenario: Configured endpoint is not loopback
- **WHEN** a WebDriver BiDi endpoint URL uses a non-loopback host
- **THEN** the system rejects endpoint probing for that endpoint
- **AND** it reports endpoint status `rejected`

#### Scenario: Endpoint probe succeeds
- **WHEN** the system connects to the configured endpoint and receives a valid response to `session.status`
- **THEN** WebDriver BiDi endpoint status is reported as `available`

#### Scenario: Endpoint probe fails
- **WHEN** the configured endpoint cannot be reached or does not respond to `session.status`
- **THEN** WebDriver BiDi endpoint status is reported as `unreachable`

### Requirement: Endpoint probing does not create browser automation state
The system SHALL NOT create browser sessions or inspect browser content during protocol capability detection.

#### Scenario: WebDriver BiDi endpoint is probed
- **WHEN** the system probes a WebDriver BiDi endpoint
- **THEN** it sends only `session.status`
- **AND** it does not send `session.new`, enumerate tabs, read cookies, inspect storage, collect logs, or evaluate scripts

### Requirement: Protocol evidence remains metadata-only
The system SHALL record protocol inference and endpoint status without storing browser content or credentials.

#### Scenario: Protocol capabilities are reported
- **WHEN** the system records browser protocol evidence
- **THEN** it records browser family, protocol support statuses, endpoint status, and rejection reason when applicable
- **AND** it does not include page content, cookies, storage values, URLs from tabs, or request/response bodies
