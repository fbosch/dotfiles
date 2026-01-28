---
name: jsdoc-typescript-docs
description: Expert guidance for TypeScript/JSDoc documentation decisions. Use when (1) documenting public library APIs for consumers, (2) deciding what to document vs skip for different audiences, (3) writing documentation for complex types or error handling, (4) setting up automated documentation generation with TypeDoc, (5) creating migration guides for breaking changes. NOT for basic JSDoc syntax—only when making documentation strategy decisions.
---

# JSDoc TypeScript Documentation

Expert-level guidance for TypeScript documentation strategy and decision-making.

## Documentation Decision Tree

| Code Type | Public Library | Internal Library | Personal/Small Team |
|-----------|----------------|------------------|---------------------|
| Public function | **Always**: Full docs + examples + errors | **Always**: Brief + non-obvious behavior | **If complex**: Why + gotchas only |
| Public interface | **Always**: With usage example | **Always**: Brief description | **If non-obvious**: Purpose only |
| Type alias | **Always**: Purpose + example | **If non-obvious**: When to use | **Skip**: If name + types are clear |
| Private function | **If complex**: Algorithm explanation | **If complex**: Why it exists | **Skip**: Unless tricky |
| Generic param | **Always**: Constraint rationale | **Always**: What it represents | **If constrained**: Why constraint |
| Constants | **If non-obvious**: Why this value | **If non-obvious**: Why this value | **Skip**: Self-explanatory values |
| Error throws | **Always**: All possible errors | **Always**: Error codes/types | **If non-obvious**: What triggers |

## Before Documenting, Ask

**Audience**: Who will read this?
- **Library users** (npm package) → Full docs: examples, edge cases, performance, migration guides
- **Internal team** (company-wide) → Focus on "why" decisions, gotchas, design context
- **Future you** (personal project) → Context for non-obvious choices, workarounds, TODOs

**Value**: Does the type system already say it?
- Types say WHAT → Document WHY and WHEN (behavior, constraints, use cases)
- Types unclear → Document WHAT first, then WHY
- Types complete → Skip redundant descriptions, document non-obvious behavior only

**Maintenance**: Will this stay synchronized?
- **Stable contracts** (public API) → Document thoroughly, changes require migration guides
- **Implementation details** → Don't document (will diverge), use code comments instead
- **Behavior that changes** → Document contract in JSDoc, validate in tests

## Critical Anti-Patterns

### NEVER: Document What Types Already Express

```typescript
// NEVER: Completely redundant
/**
 * Gets the user's name.
 * @param user - The user object
 * @returns The user's name as a string
 */
function getName(user: User): string {
  return user.name;
}
```

**Why**: Wastes time, adds clutter, becomes outdated. Types already express this contract.

**Instead**: Only document if there's non-obvious behavior:

```typescript
/**
 * Gets the user's display name.
 * Falls back to email username if name is not set.
 * Returns "Anonymous" for guest users.
 */
function getDisplayName(user: User): string {
  return user.name || user.email.split('@')[0] || 'Anonymous';
}
```

### NEVER: Skip Error Documentation in Public APIs

```typescript
// NEVER: Undocumented errors in public function
export async function fetchUser(id: string): Promise<User> {
  // Throws NotFoundError, PermissionError, NetworkError - but not documented!
}
```

**Why**: Consumers can't handle errors they don't know about. Leads to unhandled exceptions in production.

**Instead**: Document ALL possible errors:

```typescript
/**
 * Fetches user by ID.
 *
 * @throws {NotFoundError} User doesn't exist (404)
 * @throws {PermissionError} Insufficient permissions (403)
 * @throws {NetworkError} Request failed (500)
 */
export async function fetchUser(id: string): Promise<User> {
  // Implementation
}
```

### NEVER: Use Template/Placeholder Documentation

```typescript
// NEVER: Generic template docs
/**
 * TODO: Add description
 * @param data - The data
 * @returns The result
 */
export function processData(data: any): any {
  // Implementation
}
```

**Why**: Worse than no docs—suggests API is documented when it isn't. Misleads users.

**Instead**: Either document properly or omit JSDoc entirely:

```typescript
// Better: No docs than bad docs (though still not ideal for public API)
export function processData(data: ProcessInput): ProcessResult {
  // Implementation
}
```

### NEVER: Document Internal Implementation in Public API

```typescript
// NEVER: Implementation details in public docs
/**
 * Fetches users from Redis cache (primary) or PostgreSQL (fallback).
 * Uses connection pool with 10 max connections.
 * Cache TTL is 5 minutes.
 */
export async function getUsers(): Promise<User[]> {
  // Implementation
}
```

**Why**: Locks you into implementation. Users depend on Redis, you can't switch to different cache.

**Instead**: Document observable behavior only:

```typescript
/**
 * Fetches all users.
 *
 * @remarks
 * Results may be cached for up to 5 minutes.
 * For real-time data, use {@link getUsersRealtime}.
 */
export async function getUsers(): Promise<User[]> {
  // Implementation
}
```

### NEVER: Skip Migration Guides for Breaking Changes

```typescript
// NEVER: Breaking change without migration guidance
/**
 * Creates a user.
 *
 * @since 2.0.0
 * @deprecated The API changed in v2.0
 */
export function createUser(data: NewUserData): Promise<User> {
  // What changed? How do I migrate? No guidance!
}
```

**Why**: Users can't upgrade without knowing how to migrate.

**Instead**: Provide explicit migration path:

```typescript
/**
 * Creates a user.
 *
 * @remarks
 * **Breaking Change in v2.0.0**: `name` parameter moved from top-level
 * to nested under `metadata.name`.
 *
 * Migration:
 * ```typescript
 * // Before (v1.x)
 * createUser({ email, password, name });
 *
 * // After (v2.x)
 * createUser({ email, password, metadata: { name } });
 * ```
 *
 * @since 2.0.0
 */
export function createUser(data: NewUserData): Promise<User> {
  // Implementation
}
```

### NEVER: Use Non-Executable Examples

```typescript
// NEVER: Pseudocode that doesn't run
/**
 * @example
 * ```typescript
 * // Call the function with parameters
 * myFunction(param1, param2);
 * // Process the result
 * doSomething(result);
 * ```
 */
export function myFunction(a: string, b: number): Result {
  // Implementation
}
```

**Why**: Examples that don't run mislead users and break when API changes.

**Instead**: Use real, executable code:

```typescript
/**
 * @example
 * ```typescript
 * const result = myFunction('hello', 42);
 * console.log(result.value); // Output: "hello42"
 *
 * // With error handling
 * try {
 *   const result = myFunction('', -1);
 * } catch (error) {
 *   console.error('Invalid input:', error.message);
 * }
 * ```
 */
export function myFunction(a: string, b: number): Result {
  // Implementation
}
```

## When to Load References

### Load `jsdoc-syntax.md` when:
- Need specific JSDoc tag syntax (@param, @returns, @throws, etc.)
- Documenting overloaded functions or complex generics
- Need syntax for React components or classes
- Want comprehensive tag reference

### Load `library-api-docs.md` when:
- **MANDATORY**: Documenting public library for external consumers
- **MANDATORY**: Writing documentation for npm package
- Need examples of audience-specific documentation depth
- Documenting breaking changes or deprecations
- Need performance documentation patterns
- Creating migration guides

### Load `typedoc-setup.md` when:
- **MANDATORY**: Setting up automated documentation generation
- **MANDATORY**: Configuring TypeDoc for the first time
- Integrating documentation into CI/CD pipeline
- Configuring multi-package monorepo documentation
- Setting up GitHub Pages deployment
- Need documentation validation in pre-commit hooks

## Quick Wins: High-Impact Documentation

Focus documentation effort on these high-value targets:

1. **Public API functions**: 80% of user questions come from public functions
2. **Error conditions**: Undocumented errors = production incidents
3. **Complex types**: Generic types and conditional types need explanation
4. **Migration guides**: Breaking changes without migration = angry users
5. **Performance characteristics**: O(n²) operations need warnings
6. **Examples**: One good example > 100 lines of prose

## Documentation Smells (Warning Signs)

| Smell | What It Means | Fix |
|-------|---------------|-----|
| Every function has identical JSDoc | Template docs, not real docs | Remove templates, document non-obvious only |
| No @throws tags | Errors not documented | Add all possible exceptions |
| No examples in library | Theory without practice | Add real, executable examples |
| Docs contradict types | Out of sync | Update docs or simplify (let types speak) |
| Private functions have more docs than public | Inverted priorities | Focus on public API first |

## TypeDoc Validation

**Enforce documentation in CI**:

```json
// package.json
{
  "scripts": {
    "docs:validate": "typedoc --validation.notDocumented true"
  }
}
```

**Pre-commit hook**:
```bash
npm run docs:validate || exit 1
```

## Resources

- **TypeDoc**: https://typedoc.org/
- **TSDoc**: https://tsdoc.org/ (TypeScript-specific JSDoc standard)
- **JSDoc Tags**: https://jsdoc.app/
