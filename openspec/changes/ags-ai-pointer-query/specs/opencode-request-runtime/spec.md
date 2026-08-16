## Purpose

Provide a bounded machine interface for non-interactive OpenCode requests so desktop and future local workflows can submit context without owning SDK, server, or session lifecycle details.

## ADDED Requirements

### Requirement: Versioned machine protocol
The runtime SHALL accept one versioned JSON request on standard input and emit exactly one versioned JSON success or failure result followed by one newline on standard output. It MUST reject malformed JSON, trailing documents, unsupported protocol versions, and unknown request fields before contacting an OpenCode server.

#### Scenario: Valid request
- **WHEN** a caller submits a valid supported request with text and no attachments
- **THEN** the runtime emits one result with the request identifier and no non-JSON output on standard output

#### Scenario: Invalid input
- **WHEN** standard input contains malformed JSON, trailing non-whitespace bytes, an unsupported version, or an unknown request field
- **THEN** the runtime emits one `invalid_request` or `unsupported_version` failure and does not contact an OpenCode server

### Requirement: Bounded request and response data
The runtime SHALL reject input larger than 64 KiB, prompt text larger than 16 KiB UTF-8, more than four attachments, individual attachments larger than 12 MiB, aggregate attachments larger than 20 MiB, image dimensions exceeding 8192 pixels on either side, images exceeding 16 megapixels, and request timeouts outside 5 to 120 seconds. It SHALL limit normalized assistant text to 32 KiB UTF-8 and make truncation explicit.

#### Scenario: Oversized attachment
- **WHEN** a caller submits an image that exceeds a byte, dimension, pixel, or aggregate attachment limit
- **THEN** the runtime emits `attachment_too_large` before sending the image to OpenCode

#### Scenario: Oversized assistant response
- **WHEN** OpenCode returns final assistant text larger than the response limit
- **THEN** the runtime returns bounded text and marks the result as truncated

### Requirement: Verified image attachments
The runtime SHALL accept only regular PNG or JPEG files whose declared MIME type, magic bytes, dimensions, byte size, and SHA-256 digest match the request. It SHALL construct the OpenCode file part from the exact verified bytes rather than allowing OpenCode to reopen the supplied path. It MUST reject symbolic links, non-regular files, MIME mismatches, unsupported formats, and changed files.

#### Scenario: Previewed image remains unchanged
- **WHEN** a caller supplies a valid PNG with a matching digest
- **THEN** the runtime submits the bytes represented by that digest as the file attachment

#### Scenario: Image changes after preview
- **WHEN** an attachment file no longer matches its submitted digest
- **THEN** the runtime emits `attachment_changed` and does not submit the attachment

### Requirement: Trusted OpenCode execution context
The runtime SHALL require an explicit agent and tool policy. When the caller requests the deny-all tool policy, the runtime SHALL verify that the selected agent exists and has no enabled tools before submitting user context. It MUST fail with `agent_unavailable` or `agent_policy_invalid` rather than falling back to another agent.

#### Scenario: Tool-free agent is available
- **WHEN** a request selects an installed agent whose effective tool policy denies all tools
- **THEN** the runtime submits the request using that agent

#### Scenario: Agent cannot be verified
- **WHEN** the requested agent is absent, resolves to a different agent, or exposes any enabled tool under a deny-all request
- **THEN** the runtime does not submit the prompt or attachment

### Requirement: Compatible server selection and ownership
The runtime SHALL only reuse the configured loopback OpenCode endpoint after bounded health, version, and agent-policy checks pass. It SHALL start an owned temporary server when the endpoint is absent or unsuitable. It MUST NOT scan ports, use remote endpoints, restart an external server, terminate an external server, or close an external server.

#### Scenario: Compatible external server
- **WHEN** the configured loopback endpoint reports a supported version and verifies the requested agent policy
- **THEN** the runtime uses that server and leaves it running when the request ends

#### Scenario: Incompatible external server
- **WHEN** the configured loopback endpoint is unavailable, has an unsupported version, or cannot verify the requested agent policy
- **THEN** the runtime starts an owned temporary server or returns a safe unavailable error without transmitting user context to the unsuitable endpoint

### Requirement: Ephemeral request lifecycle
The runtime SHALL create one ephemeral OpenCode session per request and delete it after success, failure, timeout, or cancellation. It SHALL close an owned temporary server after the request ends. It MUST surface `cleanup_failed` when it cannot complete session cleanup and MUST NOT claim provider-side deletion.

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

### Requirement: Pinned runtime compatibility
The runtime SHALL use the pinned SDK version validated for the installed OpenCode version and run without dependency auto-install. It MUST reject unsupported CLI or server versions before attachment transmission.

#### Scenario: Supported version pair
- **WHEN** the configured OpenCode binary and server match the validated runtime version policy
- **THEN** the runtime may submit a request

#### Scenario: Unsupported version pair
- **WHEN** the configured OpenCode server or binary is outside the validated version policy
- **THEN** the runtime returns `incompatible_version` before submitting the prompt or attachment
