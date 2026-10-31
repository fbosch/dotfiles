# Codemode

"Separate tool calls" means separate invocations, not an instruction to avoid
codemode. Keep each operation as its own `tools.*` call inside one script.
Only an explicit request for direct tools or for no codemode opts out.

Before using tools, state one short execution plan with the number of tool
calls and the chosen route: direct or codemode. Count tool invocations, not
answer formatting. For multiple independent calls, the plan must choose one
codemode script with Promise.allSettled. Execute the route you stated.

When a structured read returns source-line objects, decode the source before
parsing JSON. Its rendered display text contains anchors and is not valid JSON:

```js
const source = readResult.lines.map(row => row.text).join("\n");
const data = JSON.parse(source);
```

Keep requested values as well as their names when extracting declarations.

## Route tools before calling them

- Exactly one trivial tool call: use the tool directly. A request to read one
  small known file and answer from it needs one direct read, not codemode.
  Formatting the result and writing the final answer do not count as tool calls.
- Two or more independent operations: call ONE `codemode` script and start all
  calls in `Promise.allSettled([...])`. Never issue sibling direct tool calls
  or await independent calls one at a time. This applies to short reads,
  required references, mixed searches, and separately requested checks.
- Dependencies or sequential instructions: await each prerequisite, then batch
  the independent calls it unlocks. Keep read-back and conflicting writes ordered.
  Retain successful results instead of reading them again.
- An explicit request for direct tools without codemode overrides batching.
  A request for separate invocations alone does not.

Two trivial reads are two tool calls. For two known paths, use one codemode
call containing both reads, not two direct read calls.

## Inspect, reduce, report

Check rejected promises, fulfilled error results, and command exit codes.
Attribute each result to its path or exact tool name.

Use the declared return type and inspect actual data shapes. Do not reject
an object merely because you expected an array; inspect its fields to find
the requested data. When a read supplies line objects, parse JSON
from `result.lines.map(row => row.text).join("\n")`, not rendered anchor-prefixed
`result.text`.

For short references, return their source lines once. Inspect actual contents;
do not guess keywords and discard unmatched lines. For large reads, return
only relevant `{path, anchor, text}` rows. Never return both rendered and
structured copies.

Never print an entire results array, read object, or write acknowledgement.
Keep intermediate reads and writes inside the script. Return only the requested
values, errors, and verification evidence. A successful write acknowledgement
may contain the whole file; extract its status without printing its payload.

The final answer must include each source path or exact tool name, its actual
value or status, any error detail, and read-back verification for edits.
Use tool names, not numbered checks.

Before the final answer, check that reported constants include both their names
and initializer values, preferably the full declaration. Names alone are not
a complete result. Do not discard source values when extracting symbols.
