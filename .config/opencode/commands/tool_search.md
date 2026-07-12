---
description: Search the extended toolbox for a tool or capability
agent: explore
---

Query: $ARGUMENTS

If Query is empty, respond only: "Usage: /tool_search <tool name, regex, or capability>"

Search the extended toolbox for Query.

1. Use `toolbox_search_regex` when Query is a tool name, server prefix, or regular expression.
2. Use `toolbox_search_bm25` when Query describes a capability in natural language.
3. Do not execute any discovered tool.
4. Return matching tools with their tool IDs, a one-line purpose, and argument schemas.
5. If no tools match, state that plainly and suggest one refined query.
