# Tool discovery

Shared optional-classifier ranking for native `searchTools()`, native `tool_search`, and the existing `tool_load` extension. The native integration requires the Pi 0.99.1 ranking-hook patch in `~/nixos/modules/development/ai/pi/`.

## Usage and fallback

```js
// Discover tools callable from codemode without activating them.
const matches = await searchTools("inspect browser requests", { limit: 3 });

// Keep using the legacy loader for activation during this migration.
await tools.tool_load({ query: "inspect browser requests", limit: 3 });
```

All frontends share the classifier toggle in `~/.pi/agent/settings.json`:

```json
{
  "classifier": {
    "toolDiscovery": { "enabled": false, "timeoutMs": 2400 }
  }
}
```

Disabled or unavailable classification, invalid responses, and provider timeouts return the frontend's lexical matches. Native frontends use BM25; `tool_load` keeps its existing weighted lexical search. A valid `no_match` returns no matches. Caller cancellation stops the search instead of activating a fallback.

Candidates must pass admission and native namespace filtering before classifier submission. The classifier receives at most 24 candidate names and first-line descriptions of at most 180 characters, plus at most 500 query characters. Native document text, parameter schemas, terminal output, and package command bodies are not classifier inputs. Returned inference usage is reported before match validation or cancellation. Billed failures retain usage on an error result without loading tools; codemode accounts for it once. Changing the SDK patch requires a rebuilt Pi package: `/reload` only reloads extensions.

## Files and lifecycle

- `index.ts` registers `tool_load`, preserves its startup deferral and family expansion, and installs the native ranking callback per session.
- `native-ranking.ts` adapts the pinned SDK hook to the shared ranker without changing native exposure or activation policies.
- `../../lib/discovery-ranking.ts` builds the bounded classifier request and handles lexical fallback.
- `__tests__/` covers hook cleanup, captured subagent admission, namespace restrictions, fallback, cancellation, usage, and stale or hidden loader matches.

Session shutdown removes the callback. Repeated session starts replace it. Unpatched Pi 0.99.1 retains `tool_load` and native BM25 search without attempting native hook registration.

## Before removing tool_load

Native `tool_search` still activates only inactive `codemode` or `deferred` tools and remains model-only. The current `tool_load` also supports managed inactive-direct tools, codemode calls, startup deferral, and underscore-family expansion. Replace or deliberately retire those behaviors, preserve subagent permissions, and update callers and instructions before removing the loader.
