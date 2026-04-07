---
name: security-and-hardening
description: Threat-model-first hardening for app and API changes. Use when work touches untrusted input, auth/session logic, secrets, sensitive data paths, file upload, webhooks, or third-party integrations.
---

# Security and Hardening

Prioritize exploitability and blast radius, then apply controls where they reduce real risk.

## Use when

- Accepting or transforming untrusted input
- Changing authentication, authorization, or session behavior
- Handling secrets, tokens, credentials, or sensitive data
- Integrating third-party APIs, webhooks, uploads, or redirects
- Preparing high-risk changes for release

## Threat-model prompts

Before implementation or review, answer:

- What is the trust boundary crossed by this change?
- What is the highest-impact abuse path if assumptions fail?
- Which control fails closed, and which one fails open?
- What user/account/data scope is affected if exploited?

## Scenario router

- `Auth/session changed` -> session fixation, privilege escalation, stale-token reuse checks.
- `Untrusted input path` -> boundary validation, canonicalization, output encoding, injection tests.
- `Third-party callback/webhook` -> signature verification, replay window, idempotency, origin constraints.
- `Sensitive data path` -> least privilege, at-rest/in-transit protection, redaction in logs/telemetry.

## Workflow

1. Define trust boundaries and attack surface for the change.
2. Enumerate likely abuse cases (injection, auth bypass, data exfiltration, resource abuse).
3. Rank findings by exploitability x impact, not by code neatness.
4. Apply the control checklist below and note any remaining gaps.
5. Verify with focused tests and explicit release-risk notes.

## Control checklist

- Validate and normalize external input at boundaries.
- Enforce authn/authz at every protected operation.
- Keep secrets out of code, logs, and client-visible payloads.
- Use parameterized queries and output encoding.
- Apply safe defaults (deny by default, least privilege, explicit allowlists).
- Restrict third-party integration paths (origin/signature/redirect checks).
- Include dependency vulnerability checks where relevant.

## NEVER do this

- Never trust client-provided identity, role, tenant, or ownership fields; derive from authenticated context.
- Never authorize from cache alone without a freshness strategy on role/permission changes.
- Never log full tokens, credentials, signed payloads, or raw PII "for debugging".
- Never accept webhook/event traffic without signature validation and replay protection.
- Never sanitize after persistence; validate/canonicalize before any security decision.
- Never treat "internal-only endpoint" as a control; enforce authn/authz anyway.

## Verification examples

- Auth path: attempt horizontal and vertical privilege escalation using another user's identifiers.
- Input path: fuzz boundary payloads for injection and parser confusion (encoding, unicode, truncation).
- Integration path: send valid-signature old payload to verify replay rejection behavior.
- Data path: verify secrets/PII are redacted in logs, traces, and error payloads.

If full automation is not feasible, provide a manual reproducible procedure and expected evidence for each high-risk case.

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
- At least one abuse case per high-risk boundary is tested or explicitly deferred with rationale.
