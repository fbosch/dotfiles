# Vicinae Extensions - Agent Guide

Custom Vicinae extensions with consistent UX, keybindings, and build workflow.

## Essentials

- Extensions must pass `vici lint` (use `pnpm exec vici lint`) and follow official guidelines.
- Package manager: pnpm workspaces (use `pnpm` commands).
- Build extensions individually; use bulk build script only for full refresh.
- Prefer React Query persistence (`PersistQueryClientProvider`) with a Vicinae Cache-backed persister for cross-session query cache.

## More Guidance

- [Keybindings and actions](docs/agents/keybindings-actions.md)
- [Action ordering and UX](docs/agents/ux-patterns.md)
- [Extension catalog](docs/agents/extensions.md)
- [Compliance and structure](docs/agents/compliance-structure.md)
- [Build and dev workflow](docs/agents/build-dev.md)
- [Code style and testing](docs/agents/code-style-testing.md)
- [Common patterns](docs/agents/patterns.md)
- [Troubleshooting](docs/agents/troubleshooting.md)
- [Resources](docs/agents/resources.md)
