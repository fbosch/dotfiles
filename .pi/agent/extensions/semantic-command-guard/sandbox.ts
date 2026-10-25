import { lstatSync } from "node:fs";
import { join } from "node:path";
import { type AccessGrants, explainAccess } from "../../lib/nono-access";
import { commandFileAccesses } from "./file-access";

export type SandboxGrants = AccessGrants;
export function commandFitsSandbox(
  command: string,
  cwd: string,
  capabilities: SandboxGrants | undefined,
): boolean {
  if (!capabilities) return false;
  const accesses = commandFileAccesses(command);
  if (!accesses) return false;
  try {
    const granted = (path: string, access: "read" | "write"): string | undefined => {
      const decision = explainAccess(capabilities, cwd, path, access);
      return decision.kind === "granted" ? decision.path : undefined;
    };
    return accesses.every(({ path, access, destinationNames }) => {
      const candidate = granted(path, access);
      if (!candidate) return false;
      if (!destinationNames) return true;
      try {
        if (!lstatSync(candidate).isDirectory()) return true;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return true;
        return false;
      }
      // Copying into a directory can follow a symlink at destination/source-name.
      return destinationNames.every(
        (name) => granted(join(candidate, name), "write") !== undefined,
      );
    });
  } catch {
    return false;
  }
}
