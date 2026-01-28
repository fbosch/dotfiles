# Library API Documentation Strategies

Comprehensive strategies for documenting public library APIs. Load when documenting code for external consumers.

## Documentation Depth by Audience

### Public Library (npm package, thousands of users)

**Required Documentation**:
- Every public export (functions, classes, interfaces, types)
- All parameters with types and constraints
- Return values with possible states
- All thrown exceptions
- Performance characteristics for complex operations
- Migration guides for breaking changes
- Multiple examples showing common and edge cases

**Example: Comprehensive Function Documentation**

```typescript
/**
 * Validates and normalizes an email address.
 *
 * @remarks
 * This function performs RFC 5322 compliant validation and normalizes
 * the email to lowercase. Internationalized domain names (IDN) are
 * supported via Punycode encoding.
 *
 * Performance: O(n) where n is email length. Typical execution < 1ms.
 *
 * @param email - The email address to validate
 * @param options - Validation options
 * @param options.allowInternational - Allow non-ASCII characters (default: true)
 * @param options.requireTLD - Require top-level domain (default: true)
 *
 * @returns The normalized email address
 *
 * @throws {ValidationError} When email format is invalid
 * @throws {EncodingError} When IDN encoding fails
 *
 * @example Basic usage
 * ```typescript
 * const email = validateEmail('User@Example.COM');
 * // Returns: 'user@example.com'
 * ```
 *
 * @example With international domain
 * ```typescript
 * const email = validateEmail('user@münchen.de');
 * // Returns: 'user@xn--mnchen-3ya.de'
 * ```
 *
 * @example Error handling
 * ```typescript
 * try {
 *   validateEmail('invalid-email');
 * } catch (error) {
 *   if (error instanceof ValidationError) {
 *     console.error('Invalid email:', error.message);
 *   }
 * }
 * ```
 *
 * @see {@link https://datatracker.ietf.org/doc/html/rfc5322 | RFC 5322}
 * @since 1.0.0
 * @public
 */
export function validateEmail(
  email: string,
  options?: EmailValidationOptions
): string {
  // Implementation
}
```

### Internal Library (company-wide, ~50 users)

**Required Documentation**:
- Public API overview
- Non-obvious behavior and gotchas
- Design decisions and rationale
- Links to related design docs/tickets
- Examples for complex patterns

**Skip**:
- Obvious parameter descriptions
- Internal implementation details
- Redundant type information

**Example: Focused Internal Documentation**

```typescript
/**
 * Validates email addresses using our company's email policy.
 *
 * @remarks
 * Uses strict validation that rejects:
 * - Disposable email providers (see DISPOSABLE_DOMAINS list)
 * - Role-based emails (admin@, noreply@, etc.)
 * - Emails from blocklist (Firestore collection 'blocked_emails')
 *
 * Design context: https://docs.company.com/email-validation-rfc
 *
 * @throws {ValidationError} With specific error codes (see EmailErrorCode enum)
 *
 * @example
 * ```typescript
 * const email = await validateCompanyEmail('user@gmail.com');
 * ```
 */
export async function validateCompanyEmail(email: string): Promise<string> {
  // Implementation
}
```

### Personal/Small Team (<5 developers)

**Required Documentation**:
- Why you made specific choices (future you will forget)
- Workarounds for bugs or limitations
- TODOs and known issues
- Context that isn't obvious from code

**Skip**:
- Syntax examples (types are self-documenting)
- Obvious helpers
- Standard patterns

**Example: Context-Focused Documentation**

```typescript
/**
 * Validates email with custom logic for legacy users.
 *
 * NOTE: We can't use standard RFC validation because ~1000 legacy users
 * have emails with + symbols that our old system allowed. Migration
 * tracked in JIRA-1234.
 *
 * TODO: Remove legacy handling after migration completes (Q2 2024)
 */
export function validateEmail(email: string): boolean {
  // Implementation
}
```

## Documentation for Different Code Elements

### When to Document What

| Element Type | Always Document | Sometimes Document | Skip If |
|--------------|-----------------|-------------------|---------|
| Public function | Yes | - | Never skip |
| Public class | Yes | - | Never skip |
| Public interface | Yes, with usage example | - | Never skip |
| Public type alias | If non-obvious purpose | If self-explanatory | Name + types are clear |
| Generic parameter | Yes, explain constraints | - | Standard `T extends object` |
| Private function | If complex (>20 lines) | If non-obvious | Obvious helpers |
| Test helper | If used across files | - | Local test utilities |
| Constants | If non-obvious values | - | Self-explanatory |

### Complex Type Documentation

**For Advanced Generic Types**:

```typescript
/**
 * Extracts the awaited type from nested Promises.
 *
 * @typeParam T - The type to unwrap
 *
 * @remarks
 * Recursively unwraps Promise types until reaching a non-Promise type.
 * Similar to built-in `Awaited<T>` but handles edge cases with union types.
 *
 * @example
 * ```typescript
 * type A = DeepAwaited<Promise<Promise<string>>>; // string
 * type B = DeepAwaited<Promise<number> | string>; // number | string
 * ```
 */
export type DeepAwaited<T> = T extends Promise<infer U>
  ? DeepAwaited<U>
  : T;
```

### Error Documentation

**Document ALL Possible Errors in Public APIs**:

```typescript
/**
 * Fetches user profile from the database.
 *
 * @throws {NotFoundError} User ID doesn't exist (404)
 * @throws {PermissionError} Caller lacks read permission (403)
 * @throws {DatabaseError} Database connection failed (500)
 * @throws {ValidationError} Invalid user ID format (400)
 *
 * @example Error handling
 * ```typescript
 * try {
 *   const profile = await fetchUserProfile(userId);
 * } catch (error) {
 *   if (error instanceof NotFoundError) {
 *     // Handle 404
 *   } else if (error instanceof PermissionError) {
 *     // Handle 403
 *   }
 * }
 * ```
 */
export async function fetchUserProfile(userId: string): Promise<UserProfile> {
  // Implementation
}
```

## Versioning and Migration

### Breaking Changes

**Always Document Migration Path**:

```typescript
/**
 * Creates a new user account.
 *
 * @param data - User registration data
 * @param data.email - User email (must be unique)
 * @param data.password - Password (min 8 chars, will be hashed)
 * @param data.metadata - Optional user metadata
 *
 * @returns The created user with generated ID
 *
 * @since 2.0.0
 *
 * @remarks
 * **Breaking Change in v2.0.0**: The `name` parameter is now nested under
 * `metadata.name` instead of being a top-level field.
 *
 * Migration:
 * ```typescript
 * // Before (v1.x)
 * createUser({ email, password, name });
 *
 * // After (v2.x)
 * createUser({ email, password, metadata: { name } });
 * ```
 */
export function createUser(data: CreateUserData): Promise<User> {
  // Implementation
}
```

### Deprecation

**Provide Clear Alternatives**:

```typescript
/**
 * Fetches all users from the database.
 *
 * @deprecated Since v3.0.0. Use {@link getUsersPaginated} instead for better
 * performance with large datasets.
 *
 * This function will be removed in v4.0.0.
 *
 * @example Migration
 * ```typescript
 * // Before
 * const users = await getUsers();
 *
 * // After
 * const { users } = await getUsersPaginated({ limit: 100 });
 * ```
 */
export async function getUsers(): Promise<User[]> {
  // Implementation
}
```

## Performance Documentation

**Document Performance Characteristics for Non-Trivial Operations**:

```typescript
/**
 * Sorts an array of items using a custom comparator.
 *
 * @remarks
 * **Time Complexity**: O(n log n) average case, O(n²) worst case
 * **Space Complexity**: O(log n) due to recursion
 * **Stability**: Stable sort (preserves order of equal elements)
 *
 * For arrays larger than 10,000 items, consider using a streaming approach
 * or {@link sortLarge} which uses external sorting.
 *
 * @param items - The array to sort (modified in-place)
 * @param comparator - Comparison function
 */
export function sortItems<T>(
  items: T[],
  comparator: (a: T, b: T) => number
): void {
  // Implementation
}
```

## Examples Best Practices

### Multiple Examples for Different Use Cases

```typescript
/**
 * Makes an HTTP request with retry logic.
 *
 * @example Basic GET request
 * ```typescript
 * const data = await request('https://api.example.com/users');
 * ```
 *
 * @example POST with body
 * ```typescript
 * const user = await request('https://api.example.com/users', {
 *   method: 'POST',
 *   body: { name: 'John', email: 'john@example.com' },
 * });
 * ```
 *
 * @example With retry configuration
 * ```typescript
 * const data = await request('https://api.example.com/data', {
 *   retries: 3,
 *   retryDelay: 1000,
 *   timeout: 5000,
 * });
 * ```
 *
 * @example Error handling
 * ```typescript
 * try {
 *   const data = await request('https://api.example.com/data');
 * } catch (error) {
 *   if (error instanceof TimeoutError) {
 *     console.error('Request timed out');
 *   } else if (error instanceof NetworkError) {
 *     console.error('Network failure');
 *   }
 * }
 * ```
 */
export async function request<T>(url: string, options?: RequestOptions): Promise<T> {
  // Implementation
}
```

## Linking and Cross-References

### Effective Use of @see Tags

```typescript
/**
 * User authentication service.
 *
 * @see {@link AuthService.login} for authentication
 * @see {@link AuthService.logout} for session termination
 * @see {@link https://docs.company.com/auth | Authentication Guide}
 *
 * @example
 * ```typescript
 * const auth = new AuthService();
 * await auth.login({ email, password });
 * ```
 */
export class AuthService {
  /**
   * Authenticates a user and creates a session.
   *
   * @see {@link AuthService.logout} to end the session
   * @see {@link SessionManager} for session lifecycle
   */
  async login(credentials: Credentials): Promise<Session> {
    // Implementation
  }
}
```
