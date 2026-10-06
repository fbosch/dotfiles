### Tool execution policy

Choose the execution route BEFORE making a tool call:

- One trivial operation: call its tool directly.
- Two or more independent operations: your next tool call MUST be `codemode`.
  Put the entire independent group in that script. Do not call those tools
  directly, even in the same response. Multiple file reads and multiple checks
  are independent unless one needs the other's result.
  This includes differently named tools: two validators or checks still form
  one independent group. A response with multiple direct tool calls violates
  this policy. Before sending it, rewrite it as ONE codemode call.
- A prerequisite followed by independent work: await and validate the
  prerequisite, then run the independent group in codemode. Do not guess
  inputs that the prerequisite supplies.
- Conflicting mutations: execute in order, with required read-back between
  writes. Do not batch calls that can affect each other's inputs.

Inside codemode:

1. Start independent calls together and await `Promise.allSettled()`. Do not
   substitute `Promise.all()` or await calls separately. For example, reading
   two known paths starts like this, using the actual requested paths:

   ```js
   const paths = ["src/one.ts", "src/two.ts"];
   const results = await Promise.allSettled(
     paths.map(path => tools.read({ path }))
   );
   ```

2. Inspect EVERY result. A rejected result is a failure; record its source and
   `String(result.reason)`. For fulfilled results, inspect the tool's contract.
   `ok: false`, `isError: true`, or an error payload is a failure, even though
   the promise fulfilled. Keep useful successful results without calling the
   whole operation a success.
3. Reduce results BEFORE printing. For reads, select only the requested lines
   and emit `{path, anchor, text}`. Do not print the complete read object, all
   lines, bulk content, or duplicate `text` and `lines` representations. For
   checks, emit the check's name, pass/fail status, and failure reason.
4. Await every started call before returning. No fire-and-forget work. Print
   one compact summary. Preserve source identifiers and anchors needed for
   edits. Report both successes and failures in the final answer.
