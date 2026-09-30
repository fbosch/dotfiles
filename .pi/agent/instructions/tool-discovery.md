---
when:
  tools:
    any:
      - tool_load
---

# Tool discovery

- Use `tool_load` to find and activate inactive tools by capability. In codemode, call `tools.tool_load({ query, limit })`.
- Pi's native `searchTools()` searches tools already callable from codemode; it does not activate tools. Pi's `tool_search` remains a separate built-in tool.
- Our custom loader's current name is `tool_load`, not `search_tools`. Use `tool_load` when upstream skill guidance refers to the old name; no old-name tool alias is registered.
