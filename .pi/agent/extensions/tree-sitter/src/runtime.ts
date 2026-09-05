async function importRuntime() {
  const [grammar, languages, trees] = await Promise.all([
    import("./grammar.js"),
    import("./languages.js"),
    import("./parse-tree.js"),
  ]);
  return { grammar, languages, trees };
}

let runtime: ReturnType<typeof importRuntime> | undefined;

export function loadSyntaxRuntime() {
  // Share one import across concurrent tools and per-file extraction, including under Jiti.
  runtime ??= importRuntime().catch((error: unknown) => {
    runtime = undefined;
    throw error;
  });
  return runtime;
}
