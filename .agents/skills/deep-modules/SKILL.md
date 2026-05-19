---
name: deep-modules
description: "Recognize, design, and refactor toward deep modules: small, stable interfaces hiding substantial cohesive implementation complexity. Use when reviewing or changing module boundaries, APIs, SDKs, React components, hooks, services, CLI commands, package structure, abstraction layers, pass-through wrappers, prop drilling, temporal decomposition, information leakage, or shallow modules."
---

# Deep Modules

## Purpose

Use deep modules to reduce system complexity by putting substantial, cohesive behavior behind a small interface.

Ousterhout defines a deep module as a module whose interface is much simpler than its implementation. Parnas supplies the foundational decomposition rule: choose module boundaries around hidden design decisions, especially decisions likely to change, instead of around execution steps.

Treat "module" broadly: function, class, package, hook, React component, service, endpoint, CLI command, adapter, database layer, SDK client, or subsystem.

## When to Use

Use this skill when designing or reviewing:

- Public APIs, internal service boundaries, SDKs, hooks, components, command interfaces, or package/module layouts.
- Refactors involving many small classes, pass-through functions, wrapper services, prop drilling, or duplicated orchestration.
- Code where callers must know storage formats, parsing rules, setup order, retry policy, caching, validation, lifecycle, cleanup, pagination, authorization, or SDK quirks.
- Modules that are split across files but still change together for one design decision.
- Frontend components whose parents manage child internals such as loading states, derived labels, disabled states, keyboard behavior, animation phases, or SDK calls.
- API flows where clients orchestrate internal workflow steps instead of requesting a complete outcome.

Do not use deepness as a blanket excuse to merge unrelated responsibilities or hide decisions that callers must intentionally control.

## Core Principles

- Optimize for depth, not smallness. A deep module has high benefit relative to interface cost.
- Count interface cost broadly: public methods, props, parameters, return shapes, errors, events, config flags, docs, preconditions, sequencing rules, and caller assumptions.
- Hide knowledge, not just code. Encapsulation only helps when callers no longer need to know the hidden decision.
- Decompose by design decision. Good boundaries own decisions such as file format, protocol, cache policy, layout behavior, retry strategy, validation, persistence, or lifecycle.
- Avoid temporal decomposition. Splitting by execution order often leaks one decision across many modules.
- Make each layer a different abstraction. A layer that mostly forwards calls, props, parameters, or errors is shallow unless it adapts, enforces policy, or preserves compatibility.
- Pull complexity downward. Prefer a harder implementation when it gives many callers a simpler, safer interface.
- Prefer somewhat general-purpose interfaces. Cover current needs with an interface that is not specialized to one caller's incidental workflow.
- Design common paths first. Make frequent behavior automatic or one-call; keep rare behavior available without burdening the common path.
- Bring code together when it shares hidden knowledge or when combining it simplifies the interface.
- Split code apart when one module mixes unrelated policies, combines general-purpose and special-purpose logic, or exposes multiple unrelated concepts under one name.

## Procedure

1. Identify the candidate boundary and name the caller goal it should serve.
2. Inventory the full interface: methods, props, arguments, result shapes, events, errors, config, required order, docs, and informal assumptions.
3. Inventory hidden knowledge: data structures, formats, protocols, validation, defaults, retries, caching, layout rules, lifecycle, concurrency, permissions, persistence, SDK details, and edge cases.
4. State the module's unique value. If callers could inline it with little loss, treat it as shallow.
5. Find the hidden design decision. A strong module owns at least one important decision that other modules no longer need to know.
6. Search for leakage: repeated setup, duplicated constants, shared formats, caller-managed sequencing, parent-owned child state, pass-through arguments, or one change touching many modules.
7. Redesign the interface around the caller's outcome, not the implementation steps.
8. Collapse pass-through layers unless they add a distinct abstraction, enforce policy, adapt an external API, or isolate compatibility.
9. Move orchestration, defaults, validation, error aggregation, retries, resource cleanup, and status derivation into the owning module when callers would otherwise repeat them.
10. Separate reusable mechanism from special-purpose policy. Keep the mechanism behind a stable interface; keep product-specific policy near the use case.
11. Replace mandatory call sequences with one coherent operation when callers do not need to intervene between steps.
12. Replace long pass-through parameter chains with ownership at the right layer. Use a context/options object only when it narrows the interface without becoming an untyped dependency bag.
13. Re-check depth. The refactor should expose fewer concepts, require less order knowledge, and localize changes that previously spread across callers.
14. Preserve compatibility deliberately. If the interface is shipped, persisted, or externally consumed, evolve it with migration/deprecation instead of deleting shallow pieces blindly.

Use this quick classification during review:

| Signal | Prefer | Why |
| --- | --- | --- |
| Wrapper repeats the callee signature | Delete wrapper or inline call | It adds interface cost without hiding knowledge. |
| Several modules change for one policy/format/lifecycle decision | Join ownership under one module | The decision is leaking across boundaries. |
| One module mixes reusable mechanism with product-specific policy | Split mechanism from policy | General-purpose code becomes deeper when not contaminated by one use case. |
| Many callers repeat setup, validation, cleanup, retries, or status derivation | Pull behavior into callee | Callers should request outcomes, not orchestrate internals. |
| Parent component owns child-only loading, disabled, focus, animation, or SDK state | Move state into child/hook | The parent is coupled to implementation details. |
| Thin layer adapts an external API, preserves a shipped contract, or enforces policy | Keep shallow layer | The shallowness has boundary value. |

## Examples

Shallow pass-through function:

```ts
function getUser(
  id: string,
  includeTeams: boolean,
  traceId: string,
): Promise<UserDto> {
  return userClient.getUser(id, includeTeams, traceId);
}
```

Better if no new abstraction exists:

```ts
const user = await userClient.getUser(id, { includeTeams: true });
```

Deeper if callers need a complete domain outcome:

```ts
const overview = await accountOverview.load(id);
```

`accountOverview.load` is deep if it hides user fetches, team fetches, billing lookup, authorization filtering, DTO assembly, tracing, and fallback behavior behind one caller goal.

Shallow frontend component:

```tsx
<CheckoutForm
  cart={cart}
  stripe={stripe}
  clientSecret={clientSecret}
  disabled={isSubmitting || !isValid}
  errors={paymentErrors}
  onValidate={validateCart}
  onTokenize={tokenizeCard}
  onSubmit={submitPayment}
  onRetry={retryPayment}
/>
```

Deeper frontend component:

```tsx
<CheckoutPanel cartId={cart.id} onComplete={showReceipt} />
```

`CheckoutPanel` is deep if it owns validation, payment SDK lifecycle, disabled states, retry behavior, error mapping, accessibility states, and receipt transition. It is too deep if it hides business decisions the parent must control, such as legally available payment methods.

Shallow API workflow:

```http
POST /csv/parse
POST /imports/validate
POST /imports/dedupe
POST /imports/commit
```

This leaks the import pipeline to every client. Clients must know ordering, intermediate schemas, validation behavior, retries, and partial-failure handling.

Deeper API:

```http
POST /imports
GET /imports/{id}
```

The import service owns parsing, validation, dedupe, persistence, idempotency, retries, and status reporting. Expose intermediate decisions only when clients have a real user-facing choice.

Shallow temporal decomposition:

```ts
const raw = readConfigFile(path);
const parsed = parseConfig(raw);
const expanded = applyEnvOverrides(parsed);
const valid = validateConfig(expanded);
const config = cacheConfig(valid);
```

Deeper module:

```ts
const config = await configLoader.load(path);
```

`configLoader` hides file format, environment override rules, validation, defaults, and caching. Keep separate interfaces only for steps that are independently useful or require caller decisions.

Prop-drilling ownership leak:

```tsx
<SearchPage
  query={query}
  setQuery={setQuery}
  filters={filters}
  setFilters={setFilters}
  isPending={isPending}
  results={results}
  error={error}
  retry={retry}
/>
```

Deeper ownership:

```tsx
<SearchExperience initialQuery={routeQuery} onSelect={openResult} />
```

`SearchExperience` or a `useSearchExperience` hook should own debouncing, URL normalization, filter defaults, loading state, retry, empty states, and result mapping if the parent only cares about selected results. Keep query/filter state outside only when the parent coordinates it with other page-level features.

Canonical deep examples:

- Unix file I/O: a small interface such as `open`, `read`, `write`, `seek`, and `close` hides filesystems, devices, permissions, caching, and concurrency.
- Garbage collection: most callers get memory reclamation with almost no explicit interface.

Canonical shallow examples:

- Basic linked list wrappers: interface often approaches implementation complexity and hides little.
- One-line methods that call another method with the same signature.
- Components that rename props and forward all behavior to a child.

Valid shallow exceptions:

- Adapter: translates one external interface to another at a boundary.
- Compatibility facade: preserves a shipped API while delegating internally.
- Decorator or middleware: intentionally preserves an interface while adding cross-cutting behavior.
- Strategy implementation: shares an interface so callers can intentionally swap behavior.
- Tiny private helper: improves local readability without becoming a public abstraction.

## Review Checklist

- What design decision does this module hide?
- Is the interface much simpler than the implementation?
- Could a caller inline this module without losing much?
- Does the caller need to know call order, lifecycle, storage format, protocol details, retry policy, validation rules, or SDK quirks?
- If one hidden decision changes, how many modules must change?
- Are public parameters, props, errors, or return fields mostly forwarded to another layer?
- Does this layer introduce a new abstraction, or just rename the layer below?
- Are there repeated setup, teardown, validation, mapping, or error-handling sequences across callers?
- Are rare options making the common path harder to understand?
- Are defaults, special cases, and error cases handled inside the module where possible?
- Is the module cohesive around shared knowledge, or merely grouped by execution phase?
- Would combining two modules reduce interface complexity?
- Would splitting the module separate unrelated policies or general-purpose code from special-purpose code?
- Are private fields still leaked through getters, flags, event names, DTO shapes, or required caller behavior?
- Is an options/context object narrowing the interface, or becoming a grab bag of hidden dependencies?
- Are tests coupled to implementation steps rather than observable behavior?

## Common Pitfalls

- NEVER split by workflow phase when the phases share one changing decision. A parser, validator, deduper, and committer that all know the import schema are one leaked schema decision, not four independent modules.
- NEVER add a wrapper just to rename a method, forward parameters, or "make a layer." Every new interface must hide knowledge, enforce policy, adapt a boundary, or preserve compatibility.
- NEVER pass options through intermediate layers that do not use them. Move ownership to the layer that needs the option, or pass a narrow capability/object at construction time.
- NEVER solve shallow APIs by adding a broad `context`, `options`, or `config` bag without ownership rules. Bags shrink signatures but often expand hidden coupling.
- NEVER expose rare controls on the common path unless most callers need to reason about them. Prefer defaults, secondary methods, or advanced options.
- NEVER hide security, compliance, billing, privacy, or product decisions merely to make an interface look small. Deep modules hide mechanics; they do not remove necessary control.
- NEVER refactor a shipped or persisted interface as if it were private code. Use compatibility, migration, or deprecation when external consumers may depend on it.

- Treating "small class" or "one function per step" as automatically good design.
- Creating many shallow modules that increase names, files, interfaces, and navigation without hiding complexity.
- Hiding code behind private methods while still exposing the underlying design decision.
- Building pass-through abstractions that duplicate signatures from the next layer down.
- Passing variables through many layers because ownership is at the wrong layer.
- Designing APIs around today's single caller instead of the stable concept underneath.
- Over-generalizing into a framework with vague hooks, generic maps, and unclear ownership.
- Merging unrelated responsibilities merely to reduce file count.
- Hiding behavior that must remain explicit for security, compliance, auditability, performance, or product control.
- Adding configuration parameters instead of choosing safe defaults.
- Exposing implementation errors directly instead of aggregating, translating, or defining them out of existence.
- Refactoring public interfaces without accounting for shipped clients, persisted data, or compatibility constraints.

## References

- John Ousterhout, A Philosophy of Software Design, 2nd ed., Yaknyam Press, 2021. Focus: chapters 4-9.
- John Ousterhout, Stanford CS190 "Modular Design" lecture notes: https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=modularDesign
- John Ousterhout, Stanford CS190 course description: https://web.stanford.edu/~ouster/cs190-winter23/
- John Ousterhout, Software Design Book page: https://web.stanford.edu/~ouster/cgi-bin/book.php
- D. L. Parnas, "On the Criteria To Be Used in Decomposing Systems into Modules", Communications of the ACM, 15(12), 1972: https://dl.acm.org/doi/10.1145/361598.361623
