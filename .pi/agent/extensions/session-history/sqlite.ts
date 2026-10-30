type SqliteModule = typeof import("node:sqlite");

let loaded: Promise<SqliteModule> | undefined;

function isSqliteExperimentalWarning(
  warning: string | Error,
  typeOrOptions: string | NodeJS.EmitWarningOptions | undefined,
): boolean {
  const message = typeof warning === "string" ? warning : warning.message;
  const type =
    typeof warning !== "string"
      ? warning.name
      : typeof typeOrOptions === "object"
        ? typeOrOptions.type
        : typeOrOptions;
  return type === "ExperimentalWarning" && /sqlite/i.test(message);
}

/**
 * Pi 1.4.0 runs on Node 22, where importing `node:sqlite` prints an ExperimentalWarning to
 * stderr and corrupts the fullscreen TUI. Only that warning is filtered, and only during the
 * import. shortcut: remove this wrapper once Pi's runtime ships Node 24, where SQLite is stable.
 */
export function loadSqlite(): Promise<SqliteModule> {
  loaded ??= (async () => {
    const original = process.emitWarning;
    const emit = original.bind(process);
    const filtered = (
      warning: string | Error,
      typeOrOptions?: string | NodeJS.EmitWarningOptions,
      code?: string,
    ) => {
      if (isSqliteExperimentalWarning(warning, typeOrOptions)) return;
      if (typeof typeOrOptions === "object") emit(warning, typeOrOptions);
      else emit(warning, typeOrOptions, code);
    };
    Reflect.set(process, "emitWarning", filtered);
    try {
      return await import("node:sqlite");
    } finally {
      Reflect.set(process, "emitWarning", original);
    }
  })();
  return loaded;
}
