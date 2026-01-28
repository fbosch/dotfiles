# Advanced Type Inference Techniques

Load this when working with complex type inference problems.

## The `infer` Keyword

### Extract Array Element Type

```typescript
type ElementType<T> = T extends (infer U)[] ? U : never;

type NumArray = number[];
type Num = ElementType<NumArray>; // number
```

### Extract Promise Type

```typescript
type PromiseType<T> = T extends Promise<infer U> ? U : never;

type AsyncNum = PromiseType<Promise<number>>; // number
```

### Extract Function Parameters

```typescript
type Parameters<T> = T extends (...args: infer P) => any ? P : never;

function foo(a: string, b: number) {}
type FooParams = Parameters<typeof foo>; // [string, number]
```

### Extract Function Return Type

```typescript
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;

function getUser() {
  return { id: 1, name: "John" };
}

type User = ReturnType<typeof getUser>;
// Type: { id: number; name: string; }
```

### Constraints on `infer` (TypeScript 4.7+)

**EXPERT TRICK**: Use `extends` constraints directly on `infer` to simplify nested conditionals.

```typescript
// Old way (nested conditionals)
type FirstIfStringOld<T> = 
  T extends [infer S, ...unknown[]]
    ? S extends string
      ? S
      : never
    : never;

// New way (constraint on infer)
type FirstIfString<T> = 
  T extends [infer S extends string, ...unknown[]]
    ? S
    : never;

type A = FirstIfString<[string, number, number]>; // string
type B = FirstIfString<["hello", number, number]>; // "hello"
type C = FirstIfString<["hello" | "world", boolean]>; // "hello" | "world"
type D = FirstIfString<[boolean, number, string]>; // never
```

## Type Guards

### Basic Type Guard

```typescript
function isString(value: unknown): value is string {
  return typeof value === "string";
}
```

### Generic Array Type Guard

```typescript
function isArrayOf<T>(
  value: unknown,
  guard: (item: unknown) => item is T,
): value is T[] {
  return Array.isArray(value) && value.every(guard);
}

const data: unknown = ["a", "b", "c"];

if (isArrayOf(data, isString)) {
  data.forEach((s) => s.toUpperCase()); // Type: string[]
}
```

### Assertion Functions

```typescript
function assertIsString(value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new Error("Not a string");
  }
}

function processValue(value: unknown) {
  assertIsString(value);
  // value is now typed as string
  console.log(value.toUpperCase());
}
```

## Distributive Conditional Types

**KEY CONCEPT**: When a conditional type acts on a generic type parameter that's a union, TypeScript distributes over each member.

```typescript
type ToArray<T> = T extends any ? T[] : never;

type StrOrNumArray = ToArray<string | number>;
// Type: string[] | number[] (NOT (string | number)[])
```

**When distribution is NOT wanted**, wrap the type parameter in a tuple:

```typescript
type ToArrayNoDistribute<T> = [T] extends [any] ? T[] : never;

type Combined = ToArrayNoDistribute<string | number>;
// Type: (string | number)[]
```

## Inferring Nested Property Types

```typescript
type MessageOf<T> = T extends { message: infer M } ? M : never;

interface Email {
  message: string;
}

interface Dog {
  bark(): void;
}

type EmailMessageContents = MessageOf<Email>; // string
type DogMessageContents = MessageOf<Dog>; // never
```

## Combining Conditional Types with Mapped Types

**Pattern**: Extract properties by type

```typescript
type FunctionPropertyNames<T> = {
  [K in keyof T]: T[K] extends Function ? K : never;
}[keyof T];

type FunctionProperties<T> = Pick<T, FunctionPropertyNames<T>>;

type NonFunctionPropertyNames<T> = {
  [K in keyof T]: T[K] extends Function ? never : K;
}[keyof T];

type NonFunctionProperties<T> = Pick<T, NonFunctionPropertyNames<T>>;

interface Part {
  id: number;
  name: string;
  subparts: Part[];
  updatePart(newName: string): void;
}

type T40 = FunctionPropertyNames<Part>; // "updatePart"
type T41 = NonFunctionPropertyNames<Part>; // "id" | "name" | "subparts"
type T42 = FunctionProperties<Part>; // { updatePart(newName: string): void }
type T43 = NonFunctionProperties<Part>; // { id: number, name: string, subparts: Part[] }
```

## Key Remapping in Mapped Types (TypeScript 4.1+)

```typescript
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};

interface Person {
  name: string;
  age: number;
}

type PersonGetters = Getters<Person>;
// Type: { getName: () => string; getAge: () => number; }
```

## Filtering Properties with Key Remapping

```typescript
type PickByType<T, U> = {
  [K in keyof T as T[K] extends U ? K : never]: T[K];
};

interface Mixed {
  id: number;
  name: string;
  age: number;
  active: boolean;
}

type OnlyNumbers = PickByType<Mixed, number>;
// Type: { id: number; age: number; }
```

## Combining Conditional Types with Mapped Types for Privacy Checks

```typescript
type ExtractPII<Type> = {
  [Property in keyof Type]: Type[Property] extends { pii: true } ? true : false;
};

type DBFields = {
  id: { format: "incrementing" };
  name: { type: string; pii: true };
};

type ObjectsNeedingGDPRDeletion = ExtractPII<DBFields>;
// Resulting type: { id: false; name: true; }
```
