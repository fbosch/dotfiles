import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

interface HerdrSessionCwdDependencies {
  readonly environment?: NodeJS.ProcessEnv;
  readonly changeDirectory?: (cwd: string) => void;
  readonly writeTerminal?: (sequence: string) => void;
}

export function createHerdrSessionCwdExtension(
  dependencies: HerdrSessionCwdDependencies = {},
): ExtensionFactory {
  const environment = dependencies.environment ?? process.env;
  const changeDirectory = dependencies.changeDirectory ?? process.chdir;
  const writeTerminal =
    dependencies.writeTerminal ?? ((sequence) => process.stdout.write(sequence));

  return (pi: ExtensionAPI): void => {
    if (environment.HERDR_ENV !== "1") return;

    pi.on("session_start", (_event, ctx) => {
      if (ctx.mode !== "tui") return;

      try {
        const sessionCwd = ctx.sessionManager.getCwd();
        if (!isAbsolute(sessionCwd)) return;

        changeDirectory(sessionCwd);
        writeTerminal(`\u001b]7;${pathToFileURL(sessionCwd).href}\u001b\\`);
      } catch {
        // Keep Herdr's pane cwd when a persisted session directory is unavailable.
      }
    });
  };
}

export default createHerdrSessionCwdExtension();
