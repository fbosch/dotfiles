# Compatibility Reference

- Implement requested behavior with minimal, direct changes.
- Do not preserve prior behavior unless backward compatibility is explicitly requested.
- Default to current schema/contract only.
- Add migration, shim, fallback, or dual-read/dual-write logic only when persisted old data or external consumers are explicitly in scope.
- If compatibility need is unclear and materially changes implementation, ask one short clarifying question before coding.
- Prefer fail-loud plus explicit validation at boundaries; do not hide failures with silent defaults.
- Keep a single source of truth for defaults; do not duplicate fallback defaults across layers.
- Any approved compatibility code requires tests and a clear removal condition.
