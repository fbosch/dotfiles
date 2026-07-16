# Library Preferences

These are conditional defaults for new work. Existing repository conventions, scoped instructions, and explicit user requests take precedence. Do not add a dependency or tool merely because it is listed here.

## TypeScript

| Library | Use when | Context7 ID |
| --- | --- | --- |
| [Zod](https://zod.dev/) | Runtime validation or schema-backed parsing is needed. | `/colinhacks/zod` |
| [Effect](https://effect.website/docs/getting-started/introduction/) (`effect`) | Typed effects, resource lifecycles, or structured concurrency are needed. | `/effect-ts/effect` |
| [ts-pattern](https://github.com/gvergnaud/ts-pattern) | Branching depends on discriminated unions or nested data shapes. | `/gvergnaud/ts-pattern` |
| [es-toolkit](https://es-toolkit.dev/) | Utility functions are needed beyond the standard library. | `/es-toolkit/es-toolkit` |

## React

| Library | Use when | Context7 ID |
| --- | --- | --- |
| [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview) (React Query) | Managing remote server state in React. | `/tanstack/query` |
| [clsx](https://github.com/lukeed/clsx) with [tailwind-merge](https://github.com/dcastil/tailwind-merge) | Conditionally composing classes in a Tailwind React project. | `/lukeed/clsx`, `/dcastil/tailwind-merge` |
| [class-variance-authority](https://cva.style/docs) | Defining typed component variants in a Tailwind React design system. | `/joe-bell/cva` |
| [Lucide React](https://lucide.dev/guide/packages/lucide-react) | Adding icons to a React application. | `/lucide-icons/lucide` |

## Search And Testing

| Library | Use when | Context7 ID |
| --- | --- | --- |
| [Fuse.js](https://www.fusejs.io/) | Fuzzy search is required. | `/krisk/fuse` |
| [Vitest](https://vitest.dev/guide/) | Adding unit or component tests to a Vite or browser-oriented TypeScript project. Preserve an established Node or Bun-native test runner. | `/vitest-dev/vitest` |
| [Playwright](https://playwright.dev/docs/intro) | Browser automation or end-to-end tests are needed. | `/microsoft/playwright` |
| [Comlink](https://github.com/GoogleChromeLabs/comlink) | Communicating with Web Workers through RPC-style APIs. | `/googlechromelabs/comlink` |

## Runtime And Build

| Tool | Use when | Context7 ID |
| --- | --- | --- |
| [pnpm](https://pnpm.io/) | Starting a general Node.js project or workspace that is not Bun-native. | `/pnpm/pnpm` |
| [Bun](https://bun.sh/docs) | Building a Bun-native CLI, script, or application. | `/oven-sh/bun` |
| [Vite](https://vite.dev/guide/) | Starting a browser-oriented TypeScript application or library without an established framework toolchain. | `/vitejs/vite` |

## Tooling

| Tool | Use when | Context7 ID |
| --- | --- | --- |
| [Biome](https://biomejs.dev/guides/getting-started/) | Its supported formatting and lint rules cover the project's needs. | `/biomejs/biome` |
| [Lefthook](https://lefthook.dev/) | Adding repository Git hooks. | `/evilmartians/lefthook` |
| [Fallow](https://docs.fallow.tools) (`fallow-rs`) | Adding code-quality analysis. | `/fallow-rs/fallow` |
| [release-please](https://github.com/googleapis/release-please) | Automating versioning and release pull requests. | `/googleapis/release-please` |
| [devenv](https://devenv.sh/) and `devenv.nix` | Defining a reproducible development environment. | `/cachix/devenv` |
| [just](https://just.systems/man/en/) and a `justfile` | Adding discoverable project task recipes. | `/casey/just` |
