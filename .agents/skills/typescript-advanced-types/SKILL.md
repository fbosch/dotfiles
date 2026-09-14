---
name: typescript-advanced-types
description: Implement, review, debug, or test TypeScript type-level designs such as generic APIs, conditional and mapped types, template-literal types, inference helpers, type guards, discriminated unions, and compile-time type tests. Use when the task changes a type-level contract, not for ordinary TypeScript implementation.
---

# TypeScript Advanced Types

Use this skill for type-level design work that needs more than ordinary annotations or inference.

## Route the task

1. Read the existing types, call sites, and `tsconfig.json` before changing a type-level contract.
2. Load only the topic reference that matches the task:

   | Task                                                                                     | Reference                                                                                  |
   | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
   | Generic parameters, constraints, conditional, mapped, template-literal, or utility types | [`references/generics-and-transformations.md`](references/generics-and-transformations.md) |
   | Reusable type-safe emitters, API clients, builders, forms, or state models               | [`references/patterns.md`](references/patterns.md)                                         |
   | `infer`, type guards, assertion functions, or discriminated-union narrowing              | [`references/inference-and-testing.md`](references/inference-and-testing.md)               |
   | Type tests, pitfalls, or compiler-performance concerns                                   | [`references/guidance.md`](references/guidance.md)                                         |

3. If a task spans topics, load the smallest set of references that covers it. Do not load every reference by default.
4. Verify the result with the repository's existing typecheck and type-test workflow.

## Working rules

- Use the TypeScript version selected by the project. Check `package.json`, lockfiles, and `tsconfig.json` before relying on a version-specific feature.
- Prefer the simplest type that expresses the contract. Treat compiler performance and readable diagnostics as part of the design.
- Keep runtime validation at untrusted boundaries; type-level guarantees do not validate runtime data.
