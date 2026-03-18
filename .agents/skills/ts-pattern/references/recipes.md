# TS-Pattern Recipes

## Contents

- Reducers and state machines
- Runtime validation
- Tuple and nested matching
- Selections

## Reducers and state machines

Match the current state and incoming event together so invalid transitions stay visible.

Use this pattern when the transition depends on the combination of state and event. If the logic is a stable key-to-result mapping, prefer a lookup table instead.

```ts
import { match } from 'ts-pattern';

type State =
  | { status: 'idle' }
  | { status: 'loading'; startedAt: number }
  | { status: 'success'; data: string }
  | { status: 'error'; error: Error };

type Event =
  | { type: 'fetch' }
  | { type: 'success'; data: string }
  | { type: 'error'; error: Error }
  | { type: 'cancel' };

const reduce = (state: State, event: Event) =>
  match<[State, Event], State>([state, event])
    .with([{ status: 'idle' }, { type: 'fetch' }], () => ({
      status: 'loading',
      startedAt: Date.now(),
    }))
    .with([{ status: 'loading' }, { type: 'success' }], ([, next]) => ({
      status: 'success',
      data: next.data,
    }))
    .with([{ status: 'loading' }, { type: 'error' }], ([, next]) => ({
      status: 'error',
      error: next.error,
    }))
    .with([{ status: 'loading' }, { type: 'cancel' }], () => ({ status: 'idle' }))
    .otherwise(() => state);
```

Use `.otherwise(() => state)` only when ignored transitions are intentional and preserved transitions are part of the behavior. If every combination should be accounted for, switch to `.exhaustive()` so missing transitions stay visible at compile time.

## Runtime validation

Use `isMatching` when the runtime pattern is the source of truth.

Prefer this over parallel handwritten type guards when the structure is already being described as a pattern. If you only need one narrow boolean check, a direct guard clause is usually clearer.

```ts
import { isMatching, P } from 'ts-pattern';

const userPattern = {
  id: P.string,
  role: P.union('admin', 'member'),
  profile: {
    name: P.string,
    bio: P.optional(P.string),
  },
};

type User = P.infer<typeof userPattern>;

const parseUser = (value: unknown): User | null =>
  isMatching(userPattern, value) ? value : null;
```

## Tuple and nested matching

Use tuples when the branch depends on multiple values at once.

Reach for this when the combined case matters. Do not force tuple matching into flows where a single discriminant or lookup key already expresses the decision cleanly.

```ts
import { match, P } from 'ts-pattern';

type Command = ['print', string[]] | ['exit'] | ['sleep', number];

const run = (command: Command) =>
  match(command)
    .with(['print', P.select()], (lines) => lines.join('\n'))
    .with(['sleep', P.number.positive()], ([, ms]) => `sleep ${ms}`)
    .with(['exit'], () => 'bye')
    .exhaustive();
```

Prefer tuple matches over deeply nested `switch` + `if` stacks when the combined case is what matters.

## Selections

Use anonymous `P.select()` for one value and named selections for multiple values.

If the handler keeps drilling back into the matched value, the pattern probably wants a selection. If you are selecting half the object just to pass it through unchanged, the selection is not helping.

```ts
import { match, P } from 'ts-pattern';

type Message =
  | { type: 'email'; payload: { subject: string; body: string } }
  | { type: 'sms'; payload: { body: string } };

const summary = (message: Message) =>
  match(message)
    .with(
      { type: 'email', payload: { subject: P.select('subject'), body: P.select('body') } },
      ({ subject, body }) => `${subject}: ${body}`
    )
    .with({ type: 'sms', payload: { body: P.select() } }, (body) => body)
    .exhaustive();
```

If a handler keeps drilling into `value.foo.bar.baz`, the pattern probably wants a selection.
