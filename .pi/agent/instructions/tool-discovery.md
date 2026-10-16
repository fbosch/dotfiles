---
when:
  tools:
    any:
      - tool_load
---

# Tool discovery

- Use Pi's `tool_search`, when available, to discover and activate inactive `deferred`/`codemode` tools. Search for the specific tool or capability needed; matching one name does not load underscore-prefixed siblings. For third-party inactive-direct tools, use `tool_load`; it remains callable from codemode as `tools.tool_load({ query, limit })`.
- Pi's native `searchTools()` finds tools callable from codemode but does not activate them. `tool_search` is model-only; keep using `tool_load` from codemode when an inactive-direct tool needs activation.
- When upstream guidance says `search_tools`, use Pi's native `tool_search` for inactive `deferred`/`codemode` tools. Use `tool_load` only for inactive-direct third-party tools; there is no `search_tools` alias.
