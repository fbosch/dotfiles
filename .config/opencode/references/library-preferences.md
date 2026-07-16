# Library Preferences

These are conditional defaults for new work. Existing repository conventions, scoped instructions, and explicit user requests take precedence. Do not add a dependency or tool merely because it is listed here.

## TypeScript

| Library                                                        | Use when                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [Zod](https://zod.dev/)                                        | Runtime validation or schema-backed parsing is needed.                    |
| [Effect](https://effect.website/docs/introduction/) (`effect`) | Typed effects, resource lifecycles, or structured concurrency are needed. |
| [ts-pattern](https://github.com/gvergnaud/ts-pattern)          | Branching depends on discriminated unions or nested data shapes.          |
| [es-toolkit](https://es-toolkit.dev/)                          | Utility functions are needed beyond the standard library.                 |

## React

| Library                                                                                                 | Use when                                                     |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview) (React Query)         | Managing remote server state in React.                       |
| [clsx](https://github.com/lukeed/clsx) with [tailwind-merge](https://github.com/dcastil/tailwind-merge) | Conditionally composing classes in a Tailwind React project. |

## Search And Testing

| Library                                         | Use when                                                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [Fuse.js](https://www.fusejs.io/)               | Fuzzy search is required.                                                                                                                |
| [Vitest](https://vitest.dev/guide/)             | Adding unit or component tests to a Vite or browser-oriented TypeScript project. Preserve an established Node or Bun-native test runner. |
| [Playwright](https://playwright.dev/docs/intro) | Browser automation or end-to-end tests are needed.                                                                                       |

## Tooling

| Tool                                                           | Use when                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Biome](https://biomejs.dev/guides/getting-started/)           | Its supported formatting and lint rules cover the project's needs. |
| [Lefthook](https://lefthook.dev/)                              | Adding repository Git hooks.                                       |
| [Fallow](https://docs.fallow.tools) (`fallow-rs`)              | Adding code-quality analysis.                                      |
| [release-please](https://github.com/googleapis/release-please) | Automating versioning and release pull requests.                   |
| [devenv](https://devenv.sh/) and `devenv.nix`                  | Defining a reproducible development environment.                   |
| [just](https://just.systems/man/en/) and a `justfile`          | Adding discoverable project task recipes.                          |
