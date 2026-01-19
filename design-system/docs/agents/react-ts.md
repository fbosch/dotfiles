# React/TypeScript Conventions

- Imports: `import type React from "react";` for type-only
- Function components: use `React.FC<Props>` or explicit return types
- Props interfaces: export interfaces for composition
- Button elements: always include `type="button"`
- Conditional classes: use `cn()` utility
- Unicode in JSX: preserve characters exactly; re-read before edits
- Preserve user changes: always read files before edits
