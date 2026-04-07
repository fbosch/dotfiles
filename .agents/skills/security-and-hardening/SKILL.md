---
name: security-and-hardening
description: Practical secure-coding checklist for app and API changes. Use when code touches untrusted input, auth/session logic, secrets, data protection, or third-party integrations.
---

# Security and Hardening

Apply concrete security controls during design, implementation, and review.

## Use when

- Accepting or transforming untrusted input
- Changing authentication, authorization, or session behavior
- Handling secrets, tokens, credentials, or sensitive data
- Integrating third-party APIs, webhooks, uploads, or redirects
- Preparing high-risk changes for release

## Workflow

1. Define trust boundaries and attack surface for the change.
2. Enumerate likely abuse cases (injection, auth bypass, data exfiltration, resource abuse).
3. Apply the control checklist below and note any gaps.
4. Verify with focused tests and explicit release-risk notes.

## Control checklist

- Validate and normalize external input at boundaries.
- Enforce authn/authz at every protected operation.
- Keep secrets out of code, logs, and client-visible payloads.
- Use parameterized queries and output encoding.
- Apply safe defaults (deny by default, least privilege, explicit allowlists).
- Restrict third-party integration paths (origin/signature/redirect checks).
- Include dependency vulnerability checks where relevant.

## Output contract

Return:

1. `Threat model snapshot`
2. `Findings by severity` (critical/high/medium/low)
3. `Mitigations` (specific, implementable)
4. `Verification plan` (tests/checks)
5. `Residual risk` (what remains and why)

## Done when

- Critical paths have explicit controls.
- Findings have concrete mitigations.
- Verification steps are clear and runnable.
