---
name: tsconfig
description: |
  TypeScript tsconfig.json expert. Use when:
  - Explaining what tsconfig options mean or do
  - Configuring tsconfig for a specific use case (Node.js app, bundler project, npm library, monorepo, React app, strict mode)
  - Diagnosing tsconfig-related errors or unexpected behavior (type errors from resolution, module format issues, decorator problems, class field issues)
  - Comparing tradeoffs between compiler options (e.g., esModuleInterop vs verbatimModuleSyntax, isolatedModules vs verbatimModuleSyntax)
  - Generating, reviewing, or auditing a tsconfig.json
  - Understanding how top-level fields (include, exclude, extends, references) work
  - Choosing between module/moduleResolution combinations
  - Setting up project references / composite builds
  - Understanding what @tsconfig/bases packages provide
---

# TSConfig Skill

## Decision workflow

1. **Identify the use case** from the user's question:
   - Node.js app → `module: "nodenext"`
   - Bundler (Vite/webpack/esbuild) → `module: "esnext"` + `moduleResolution: "bundler"` + `noEmit: true`
   - npm library → `module: "node18"` or `"nodenext"`, NOT `"bundler"`
   - Monorepo package → `composite: true` + `declaration: true` + `declarationMap: true`
   - Node.js type stripping (run `.ts` directly) → add `erasableSyntaxOnly` + `verbatimModuleSyntax`

2. **Always recommend** these baseline options unless there's a specific reason not to:
   - `strict: true`
   - `skipLibCheck: true`
   - `esModuleInterop: true`
   - `forceConsistentCasingInFileNames: true`

3. **Prefer modern options**: recommend `verbatimModuleSyntax` over `isolatedModules` + `preserveValueImports` + `importsNotUsedAsValues` for TS 5.0+.

4. **Load references as needed**:
   - Full option details, types, defaults → [`references/compiler-options.md`](references/compiler-options.md)
   - `module`/`moduleResolution` matrix and confusion → [`references/module-resolution.md`](references/module-resolution.md)
   - Preset tsconfig patterns, common mistakes, option interactions → [`references/common-patterns.md`](references/common-patterns.md)

## Top-level fields quick reference

| Field | What it does |
|---|---|
| `compilerOptions` | All compiler flags |
| `include` | Glob patterns to include. Default: `["**/*"]` when `files` not set |
| `exclude` | Filters `include` globs only — does NOT prevent inclusion via `import` |
| `files` | Explicit file allowlist. Error if missing. Rarely needed. |
| `extends` | Inherit from a base config. Supports arrays (TS 5.0+). `files`/`include`/`exclude` overwrite, not merge. `references` not inherited. |
| `references` | Project references for composite builds (`tsc -b`) |

## NEVER list

- NEVER rely on `paths` for runtime resolution — it only affects type checking; emitted JS still contains the alias. Configure bundler/runtime aliases separately, or use `package.json` `"imports"`.
- NEVER rely on `exclude` as a firewall — it only filters the initial `include` glob. Any file reached via `import` is included regardless.
- NEVER use `moduleResolution: "bundler"` for npm libraries — consumers using `nodenext` will get resolution errors because bundler-only shortcuts (extensionless imports, index resolution) don't work in Node.js.
- NEVER use `moduleResolution: "node"` for new projects — it's the renamed legacy `node10` algorithm. Use `nodenext` (Node.js) or `bundler` (bundled apps).
- NEVER publish a library with `noEmit: true` — consumers need JS output and declaration files.
- NEVER set `target` expecting it controls available APIs — `target` controls output syntax downleveling; `lib` controls available type definitions. Setting `target: "es5"` with `lib: ["es2023"]` means downleveled syntax but ES2023 APIs (requiring polyfills).
- NEVER use `isolatedModules` + `preserveValueImports` + `importsNotUsedAsValues` on TS 5.0+ — `verbatimModuleSyntax` supersedes all three.
