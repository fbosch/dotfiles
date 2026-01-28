---
name: typescript-advanced-types
description: Advanced TypeScript type system for complex scenarios requiring expert-level type logic. Use when (1) building type-safe API clients, event systems, or libraries, (2) implementing compile-time validation with builders or state machines, (3) creating reusable generic utilities, (4) solving complex type inference problems, (5) experiencing type performance issues or "type instantiation depth exceeded" errors. NOT for basic TypeScript—only when standard utility types are insufficient.
---

# TypeScript Advanced Types

Expert-level TypeScript type system guidance for complex scenarios where standard approaches are insufficient.

## Decision Tree: Choose Your Approach

| What You're Building | First Try | If That Fails | Load Reference |
|---------------------|-----------|---------------|----------------|
| Type-safe event system | Mapped type over event map | Discriminated unions | [`type-patterns.md`](references/type-patterns.md#type-safe-event-emitter) |
| Type-safe API client | Conditional types with `infer` | Overloads (if endpoints < 10) | [`type-patterns.md`](references/type-patterns.md#type-safe-api-client) |
| Builder with compile-time checks | Mapped types + conditional | Accept runtime validation | [`type-patterns.md`](references/type-patterns.md#builder-pattern-with-compile-time-completeness) |
| Form validation | Generic validator class | Runtime library (Zod) | [`type-patterns.md`](references/type-patterns.md#type-safe-form-validation) |
| State machine | Discriminated unions | String literals + guards | [`type-patterns.md`](references/type-patterns.md#discriminated-union-state-machine) |
| Deep object transformations | Recursive mapped types | Limit depth or use runtime | [`type-patterns.md`](references/type-patterns.md#deep-readonlypartial) |
| Extract nested types | `infer` with constraints | Multiple `infer` attempts | [`type-inference.md`](references/type-inference.md#the-infer-keyword) |
| Filter properties by type | Mapped type + `as never` | Manual `Pick`/`Omit` | [`type-inference.md`](references/type-inference.md#filtering-properties-with-key-remapping) |
| Performance issues | See anti-patterns below | Simplify or use runtime | [`performance.md`](references/performance.md) |

## Before Designing Complex Types, Ask

**Purpose**: What problem does this solve at compile time vs runtime?
- If primarily runtime data validation → Consider Zod/io-ts instead
- If editor autocomplete/safety → Types are the right choice

**Maintainability**: Can another developer understand this in 6 months?
- Simple type + runtime check > Clever type nobody understands
- Add JSDoc comments for non-obvious type logic

**Performance**: Will this slow compilation or IDE?
- >3 levels of recursion → Add depth limit or reconsider approach
- >50 union members → Use branded strings instead
- Seeing "instantiation depth exceeded" → Load [`performance.md`](references/performance.md)

## Critical Anti-Patterns

### NEVER: Unbounded Recursion

```typescript
// NEVER: Causes "Type instantiation is excessively deep" error
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};
```

**Why**: TypeScript has recursion limits (~50 levels). Deep object trees will fail.

**Instead**: Add depth limit (default 3-5 levels):

```typescript
type DeepReadonly<T, Depth extends number = 3> = Depth extends 0
  ? T
  : { readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P], Prev<Depth>> : T[P] };
```

**When experiencing recursion errors**: **MANDATORY - LOAD ENTIRE FILE**: [`performance.md`](references/performance.md) for solutions.

### NEVER: Conditional Types in Function Return Position (Pre-5.0)

```typescript
// NEVER: Type inference breaks in older TypeScript
function process<T>(value: T): T extends string ? number : boolean {
  // TypeScript can't infer the return type correctly
}
```

**Why**: Conditional types in return position prevent proper inference in call expressions.

**Instead**: Use function overloads or upgrade to TypeScript 5.0+.

### NEVER: Overly Complex Types Instead of Runtime Validation

```typescript
// NEVER: Trying to validate email format at type level
type Email<T extends string> = 
  T extends `${string}@${string}.${string}.${string}` ? T :
  T extends `${string}@${string}.${string}` ? T :
  never;
```

**Why**: Type complexity explodes, provides no runtime safety, and slows compilation.

**Instead**: Use runtime validation (Zod, validator.js) for format validation. Types can't validate actual data at runtime.

### NEVER: Self-Referencing Conditional Types (Pre-4.1)

```typescript
// NEVER in TypeScript < 4.1: Causes compilation error
type Flatten<T> = T extends any[] ? Flatten<T[number]> : T;
```

**Why**: Recursive conditional types weren't supported until TypeScript 4.1.

**Instead**: Use helper types or upgrade to 4.1+.

### NEVER: Large Type Unions (>50 members)

```typescript
// NEVER: Slows type checking dramatically
type EventType = "event1" | "event2" | /* ... */ | "event100";
```

**Why**: Each union member must be checked during type operations. Exponential slowdown.

**Instead**: Use branded strings or const assertions:

```typescript
const EVENT_TYPES = ["event1", "event2", "event3"] as const;
type EventType = typeof EVENT_TYPES[number];
```

### NEVER: Distributive Conditionals When You Need Union Preservation

```typescript
// NEVER: When you want (string | number)[], not string[] | number[]
type ToArray<T> = T extends any ? T[] : never;
type Wrong = ToArray<string | number>; // string[] | number[] (distributed!)
```

**Why**: Conditional types distribute over unions by default.

**Instead**: Wrap in tuple to prevent distribution:

```typescript
type ToArray<T> = [T] extends [any] ? T[] : never;
type Right = ToArray<string | number>; // (string | number)[]
```

## When to Load References

### Load `type-patterns.md` when:
- **MANDATORY**: Implementing type-safe event emitters, API clients, or builders
- **MANDATORY**: Creating form validation systems with type safety
- **MANDATORY**: Building state machines with discriminated unions
- Need complete working examples of advanced patterns

### Load `type-inference.md` when:
- Working with `infer` keyword and getting unexpected results
- Extracting types from nested structures (promises, arrays, functions)
- Combining conditional types with mapped types
- Need to filter object properties by type
- Using key remapping in mapped types (TypeScript 4.1+)

### Load `performance.md` when:
- **MANDATORY**: Seeing "Type instantiation is excessively deep" errors
- **MANDATORY**: IDE becomes unresponsive during type checking
- **MANDATORY**: Compilation takes >10 seconds on small projects
- Need to debug slow type checking
- Deciding between compile-time types vs runtime validation

## Quick Reference: Key TypeScript Features by Version

| Feature | Version | When to Use |
|---------|---------|-------------|
| `infer` with constraints | 4.7+ | Simplify nested conditionals |
| Key remapping (`as`) | 4.1+ | Transform property names in mapped types |
| Recursive conditional types | 4.1+ | Flatten arrays, extract nested types |
| Template literal types | 4.1+ | String manipulation, path types |
| Variadic tuple types | 4.0+ | Type-safe function composition |
| `never` in unions | 2.0+ | Filter properties in mapped types |

## Resources

- **Official TypeScript Handbook**: https://www.typescriptlang.org/docs/handbook/
- **Type Challenges** (practice): https://github.com/type-challenges/type-challenges
- **Effective TypeScript** (book): Covers advanced patterns and anti-patterns
