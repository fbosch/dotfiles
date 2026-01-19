# Design System - Agent Guide

Design system for a Windows 11-like desktop UI with macOS-level polish.

## Essentials

- No custom CSS classes or files; use Tailwind utilities only (except base resets in `src/index.css`).
- Tokens live in `tokens.json` and map through `tailwind.config.js`.

## More Guidance

- [Design goals and philosophy](docs/agents/goals.md)
- [Color system and tokens](docs/agents/colors-tokens.md)
- [Interactions and spacing](docs/agents/interactions-spacing.md)
- [Typography and icons](docs/agents/typography-icons.md)
- [Component variants and CVA](docs/agents/components-cva.md)
- [Token policy](docs/agents/token-policy.md)
- [React/TypeScript conventions](docs/agents/react-ts.md)
- [Storybook guidance](docs/agents/storybook.md)
- [Validation checklist](docs/agents/validation.md)
- [Anti-patterns](docs/agents/anti-patterns.md)
