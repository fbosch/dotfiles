# Type-Level Guidance

## Best Practices

1. **Use `unknown` over `any`**: Enforce type checking
2. **Prefer `interface` for object shapes**: Better error messages
3. **Use `type` for unions and complex types**: More flexible
4. **Leverage type inference**: Let TypeScript infer when possible
5. **Create helper types**: Build reusable type utilities
6. **Use const assertions**: Preserve literal types
7. **Avoid type assertions**: Use type guards instead
8. **Document complex types**: Add JSDoc comments
9. **Use strict mode**: Enable all strict compiler options
10. **Test your types**: Use type tests to verify type behavior

## Common Pitfalls

1. **Over-using `any`**: Defeats the purpose of TypeScript
2. **Ignoring strict null checks**: Can lead to runtime errors
3. **Too complex types**: Can slow down compilation
4. **Not using discriminated unions**: Misses type narrowing opportunities
5. **Forgetting readonly modifiers**: Allows unintended mutations
6. **Circular type references**: Can cause compiler errors
7. **Not handling edge cases**: Like empty arrays or null values

## Performance Considerations

- Avoid deeply nested conditional types
- Use simple types when possible
- Cache complex type computations
- Limit recursion depth in recursive types
- Use build tools to skip type checking in production

## Resources

- **TypeScript Handbook**: https://www.typescriptlang.org/docs/handbook/
- **Type Challenges**: https://github.com/type-challenges/type-challenges
- **TypeScript Deep Dive**: https://basarat.gitbook.io/typescript/
- **Effective TypeScript**: Book by Dan Vanderkam
