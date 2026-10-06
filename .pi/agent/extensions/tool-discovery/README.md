# Tool discovery

Shared optional-classifier ranking for native `searchTools()`, native `tool_search`, and the existing `tool_load` extension. The native integration requires the Pi 0.99.1 ranking-hook patch in `~/nixos/modules/development/ai/pi/`.

## Usage and fallback

```js
// Discover tools callable from codemode without activating them.
const matches = await searchTools("inspect browser requests", { limit: 3 });

// tool_load remains callable from codemode and can activate retained tools.
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

Disabled or unavailable classification, invalid responses, and provider timeouts return the frontend's lexical matches. Native frontends use Pi's BM25 documents and ranker; the shared classifier reranks that bounded candidate set. `tool_load` retains a weighted lexical fallback because the pinned SDK does not expose a general BM25 API to extensions. A valid `no_match` returns no matches. Caller cancellation stops the search instead of activating a fallback.

Candidates must pass admission and native namespace filtering before classifier submission. The classifier receives at most 24 candidate names and first-line descriptions of at most 180 characters, plus at most 500 query characters. Native document text, parameter schemas, terminal output, and package command bodies are not classifier inputs. Returned inference usage is reported before match validation or cancellation. Billed failures retain usage on an error result without loading tools; codemode accounts for it once. Changing the SDK patch requires a rebuilt Pi package: `/reload` only reloads extensions.

## Files and lifecycle

- `index.ts` registers `tool_load`, applies the configured prefix override only to third-party direct/model-only tools, and installs the native ranking callback per session. Locally owned specialists use native `deferred` exposure; Pi controls native activation.
- `native-ranking.ts` adapts the pinned SDK hook to the shared ranker without changing native exposure or activation policies.
- `../../lib/discovery-ranking.ts` builds the bounded classifier request and handles lexical fallback.
- `__tests__/` covers hook cleanup, captured subagent admission, namespace restrictions, fallback, cancellation, usage, and stale or hidden loader matches.

Session shutdown removes the callback. Repeated session starts replace it. Unpatched Pi 0.99.1 retains `tool_load` and native BM25 search without attempting native hook registration.

## Roles after partial migration

Native `tool_search` activates inactive `codemode` or `deferred` tools and remains model-only. Locally owned specialists use native `deferred` exposure. `tool_load` remains callable from codemode with its existing `{ query, limit }` contract and can activate inactive-direct third-party tools selected by the configured prefixes. Both loader and native classifier ranking preserve each subagent's `tools:` admission boundary. Searches load only the ranked matches; request specific tool names or capabilities instead of expecting underscore-prefixed siblings to load together.
