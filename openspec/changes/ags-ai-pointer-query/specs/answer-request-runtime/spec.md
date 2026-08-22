## Purpose

Provide a bounded backend-neutral machine interface so desktop and future local workflows can request answers without owning provider, SDK, policy, server, or session lifecycle details.

## ADDED Requirements

### Requirement: Versioned machine protocol
The runtime SHALL accept one versioned JSON request on standard input and emit exactly one versioned JSON success or failure result followed by one newline on standard output. A request SHALL contain a request identifier, the fixed `answer` operation, prompt text, attachment descriptors, and timeout. It MUST reject malformed JSON, trailing documents, unsupported protocol versions, unknown request fields, unsupported operations, and backend-selection fields before contacting the configured backend.

#### Scenario: Valid request
- **WHEN** a caller submits a valid supported request with text and no attachments
- **THEN** the runtime emits one result with the request identifier and no non-JSON output on standard output

#### Scenario: Invalid input
- **WHEN** standard input contains malformed JSON, trailing non-whitespace bytes, an unsupported version, or an unknown request field
- **THEN** the runtime emits one `invalid_request` or `unsupported_version` failure and does not contact the configured backend

### Requirement: Bounded request and response data
The runtime SHALL reject input larger than 64 KiB, prompt text larger than 16 KiB UTF-8, more than four attachments, individual attachments larger than 12 MiB, aggregate attachments larger than 20 MiB, image dimensions exceeding 8192 pixels on either side, images exceeding 16 megapixels, and request timeouts outside 5 to 120 seconds. It SHALL limit normalized assistant text to 32 KiB UTF-8 and make truncation explicit.

#### Scenario: Oversized attachment
- **WHEN** a caller submits an image that exceeds a byte, dimension, pixel, or aggregate attachment limit
- **THEN** the runtime emits `attachment_too_large` before sending the image to the configured backend

#### Scenario: Oversized assistant response
- **WHEN** the configured backend returns final answer text larger than the response limit
- **THEN** the runtime returns bounded text and marks the result as truncated

### Requirement: Verified image attachments
The runtime SHALL accept only regular PNG or JPEG files whose declared MIME type, magic bytes, dimensions, byte size, and SHA-256 digest match the request. It SHALL pass the exact verified bytes to the configured backend rather than allowing a backend to reopen the supplied path. It MUST reject symbolic links, non-regular files, MIME mismatches, unsupported formats, and changed files.

#### Scenario: Previewed image remains unchanged
- **WHEN** a caller supplies a valid PNG with a matching digest
- **THEN** the runtime submits the bytes represented by that digest as the file attachment

#### Scenario: Image changes after preview
- **WHEN** an attachment file no longer matches its submitted digest
- **THEN** the runtime emits `attachment_changed` and does not submit the attachment

### Requirement: Trusted backend-owned execution policy
The runtime SHALL select one trusted backend through local composition and MUST NOT accept backend, agent, model, tool, endpoint, server, session, or execution-directory configuration from the request. The configured backend SHALL verify its answer-only policy before submitting user context. The initial OpenCode backend SHALL require the fixed `desktop-pointer` agent and deny-all tool policy, and SHALL fail with stable backend errors rather than falling back to another agent or policy.

#### Scenario: Configured answer backend is available
- **WHEN** the locally configured backend verifies its answer-only execution policy
- **THEN** the runtime submits the validated answer request through that backend

#### Scenario: Caller attempts to select backend policy
- **WHEN** a request includes an agent, model, tool policy, endpoint, server, session, execution directory, or other backend configuration field
- **THEN** the runtime returns `invalid_request` and does not submit the prompt or attachment

#### Scenario: OpenCode answer policy cannot be verified
- **WHEN** the configured OpenCode backend cannot resolve the fixed agent or verify its deny-all tool policy
- **THEN** the runtime returns `backend_policy_invalid` and does not submit the prompt or attachment

### Requirement: Compatible OpenCode backend ownership
The initial OpenCode backend SHALL only reuse the configured loopback endpoint after bounded health, version, image-capability, and agent-policy checks pass. It SHALL start an owned temporary server when the endpoint is absent or unsuitable. It MUST NOT scan ports, use remote endpoints, restart an external server, terminate an external server, or close an external server.

#### Scenario: Compatible external server
- **WHEN** the configured loopback endpoint reports a supported version and verifies the requested agent policy
- **THEN** the runtime uses that server and leaves it running when the request ends

#### Scenario: Incompatible external server
- **WHEN** the configured loopback endpoint is unavailable, has an unsupported version, or cannot verify the requested agent policy
- **THEN** the runtime starts an owned temporary server or returns a safe unavailable error without transmitting user context to the unsuitable endpoint

### Requirement: Ephemeral backend lifecycle
The configured backend SHALL isolate each request and clean its owned resources after success, failure, timeout, or cancellation. The initial OpenCode backend SHALL create and delete one ephemeral session per request and close an owned temporary server after the request ends. The runtime MUST surface `cleanup_failed` when backend cleanup cannot complete and MUST NOT claim provider-side deletion.

#### Scenario: Successful request cleanup
- **WHEN** OpenCode returns a valid assistant response
- **THEN** the runtime returns the normalized response and deletes the request session before completing

#### Scenario: External server ownership
- **WHEN** a request uses a compatible external server
- **THEN** cleanup deletes only the request session and does not close or terminate that server

### Requirement: Cancellation and timeout cleanup
The runtime SHALL handle cancellation and request timeout with bounded, idempotent cleanup. When a request may still be active, it SHALL attempt session abort before session deletion. Abort, deletion, and owned-server closure SHALL use independent cleanup deadlines so one hung cleanup operation does not prevent subsequent cleanup.

#### Scenario: Caller cancels an active request
- **WHEN** the runtime receives a cancellation signal while OpenCode is processing a request
- **THEN** it returns `cancelled`, attempts session abort and deletion, and closes an owned server if one exists

#### Scenario: Prompt request times out
- **WHEN** the request deadline expires before an assistant response is available
- **THEN** the runtime returns `timeout` and performs the same bounded cleanup sequence

### Requirement: Safe response normalization and diagnostics
The runtime SHALL return only final assistant text parts. It MUST exclude reasoning, tool parts, provider diagnostics, and raw SDK objects. Empty final text SHALL return `empty_response`. Failure results and diagnostics MUST NOT contain prompt text, attachment bytes, credentials, provider response bodies, or unredacted local paths.

#### Scenario: Mixed OpenCode response parts
- **WHEN** OpenCode returns final text together with reasoning or tool-related parts
- **THEN** the result contains only bounded final assistant text

#### Scenario: Provider failure
- **WHEN** an OpenCode or provider request fails
- **THEN** the runtime emits a stable error code and safe message without exposing sensitive request data

### Requirement: Semver-bounded OpenCode backend compatibility
The initial OpenCode backend SHALL use the compatible SDK range `^1.18.21` and run without dependency auto-install. It MUST accept stable CLI and server versions in that range and reject versions outside it before attachment transmission.

#### Scenario: Supported version pair
- **WHEN** the configured OpenCode binary and server match the validated runtime version policy
- **THEN** the runtime may submit a request

#### Scenario: Unsupported version pair
- **WHEN** the configured OpenCode server or binary is outside the validated version policy
- **THEN** the runtime returns `incompatible_version` before submitting the prompt or attachment
