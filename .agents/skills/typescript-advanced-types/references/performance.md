# TypeScript Type Performance Guide

**Load this when experiencing slow compilation, type instantiation errors, or IDE lag.**

## Common Performance Issues

### 1. Type Instantiation Depth Exceeded

**Problem**: Recursive types that go too deep.

```typescript
// BAD: Infinite recursion
type InfiniteBox<T> = { item: InfiniteBox<T> };
type Unpack<T> = T extends { item: infer U } ? Unpack<U> : T;
// Error: Type instantiation is excessively deep and possibly infinite
type Test = Unpack<InfiniteBox<number>>;
```

**Solution**: Add depth limit or use iterative approach.

```typescript
// GOOD: Limited depth
type UnpackWithLimit<T, Depth extends number = 5> = Depth extends 0
  ? T
  : T extends { item: infer U }
    ? UnpackWithLimit<U, Prev<Depth>>
    : T;

type Prev<N extends number> = N extends 5 ? 4
  : N extends 4 ? 3
  : N extends 3 ? 2
  : N extends 2 ? 1
  : 0;
```

### 2. Recursive Conditional Types Cannot Reference Themselves (Pre-4.1)

**Problem**: Self-referencing conditional types.

```typescript
// ERROR in older TypeScript
type ElementType<T> = T extends any[] ? ElementType<T[number]> : T;
```

**Solution**: Use intermediate mapped types or upgrade to TypeScript 4.1+.

```typescript
// Workaround: Use tail-recursion helper
type ElementTypeImpl<T, U = never> = 
  T extends any[] 
    ? ElementTypeImpl<T[number], U>
    : T | U;

type ElementType<T> = ElementTypeImpl<T>;
```

### 3. Deeply Nested Generics

**Problem**: TypeScript 4.6+ correctly identifies incompatible deeply nested types, but this can cause performance issues.

```typescript
interface Foo<T> {
  prop: T;
}

// Can cause slow type checking with many levels
declare let x: Foo<Foo<Foo<Foo<Foo<Foo<string>>>>>>;
declare let y: Foo<Foo<Foo<Foo<Foo<string>>>>>;
x = y; // Error: Type mismatch deep in the structure
```

**Solution**: Flatten type hierarchies when possible.

```typescript
// Better: Use union or simpler structure
type FlatFoo<T> = {
  prop: T;
  level: number;
};
```

### 4. Mapped Type Instantiation Caching (TypeScript 5.9+)

**Background**: TypeScript 5.9 introduced caching for mapped type instantiations to prevent redundant work.

**Problem Before 5.9**: Libraries like Zod and tRPC could cause excessive type instantiation depth errors due to repeated intermediate type calculations.

**Solution**: 
- If on TypeScript < 5.9 and experiencing issues with complex libraries, upgrade to 5.9+
- Simplify complex mapped types when possible
- Use simpler utility types when the advanced features aren't needed

### 5. Recursive Type Compatibility Checks

**Problem**: Comparing recursive types can be slow (improved in TypeScript 5.3+).

```typescript
interface A {
  value: A;
  other: string;
}

interface B {
  value: B;
  other: number;
}

// This comparison is now ~1.5x faster in TypeScript 5.3+
type Test = A extends B ? true : false;
```

**Solution**: Upgrade to TypeScript 5.3+ for automatic optimization.

## Performance Best Practices

### 1. Limit Recursion Depth

**NEVER** create unbounded recursive types. Always add a depth limit.

```typescript
// BAD
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

// GOOD
type DeepReadonly<T, Depth extends number = 3> = Depth extends 0
  ? T
  : {
      readonly [P in keyof T]: T[P] extends object 
        ? DeepReadonly<T[P], Prev<Depth>> 
        : T[P];
    };
```

### 2. Avoid Excessive Type Unions

**Problem**: Large unions slow down type checking.

```typescript
// BAD: 100+ union members
type HugeUnion = "value1" | "value2" | "value3" | /* ... 100 more */ | "value100";
```

**Solution**: Use `string` with branding or runtime validation instead.

```typescript
// GOOD: Branded type
type EventType = string & { __brand: "EventType" };

// Or use const assertion
const EVENT_TYPES = ["value1", "value2", "value3"] as const;
type EventType = typeof EVENT_TYPES[number];
```

### 3. Cache Complex Type Computations

**Pattern**: Store the result of complex type operations in type aliases.

```typescript
// BAD: Recomputing every time
function process(data: Pick<Omit<User, "password">, "id" | "name">) {}

// GOOD: Cache the result
type PublicUserInfo = Pick<Omit<User, "password">, "id" | "name">;
function process(data: PublicUserInfo) {}
```

### 4. Use Simpler Alternatives When Possible

```typescript
// Instead of complex conditional
type IsString<T> = T extends string ? true : false;
type CheckArray<T> = T extends any[] ? IsString<T[0]> : false;

// Consider runtime approach
function isStringArray(arr: unknown[]): arr is string[] {
  return arr.length > 0 && typeof arr[0] === "string";
}
```

### 5. Skip Type Checking in Production Builds

```json
// tsconfig.build.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "emitDeclarationOnly": false,
    "skipLibCheck": true  // Skip checking node_modules
  }
}
```

## Monitoring Performance

### 1. Use `--extendedDiagnostics`

```bash
tsc --extendedDiagnostics
```

Look for:
- "Time spent in type checking"
- "Time spent in program creation"
- "Time spent in emit"

### 2. Use `--generateTrace`

```bash
tsc --generateTrace trace_dir
```

Generates trace files that can be analyzed to identify bottlenecks.

### 3. Profile in VS Code

Enable TypeScript server logging:
```json
// settings.json
{
  "typescript.tsserver.log": "verbose"
}
```

## When to Choose Runtime Validation Over Types

**Consider runtime validation** (Zod, io-ts, etc.) when:

- Type logic becomes too complex (>5 levels of nesting)
- Experiencing "Type instantiation is excessively deep" errors
- IDE becomes unresponsive
- Dealing with external data that needs validation anyway
- Type safety at compile time provides minimal benefit over runtime checks

**Example**: Replace complex type validation with Zod:

```typescript
// Complex type approach
type ValidEmail<T extends string> = 
  T extends `${string}@${string}.${string}` ? T : never;

// Better: Runtime validation
import { z } from "zod";
const emailSchema = z.string().email();
type ValidEmail = z.infer<typeof emailSchema>;
```

## Debugging Type Performance Issues

1. **Isolate the problematic type**: Comment out sections until compilation speeds up
2. **Check recursion depth**: Look for self-referencing types
3. **Simplify conditionals**: Replace nested conditionals with lookup types
4. **Use type aliases**: Break complex types into smaller, named pieces
5. **Upgrade TypeScript**: Many performance improvements in recent versions
6. **Consider alternatives**: Sometimes runtime validation is more practical
