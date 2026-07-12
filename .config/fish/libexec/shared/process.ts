import { type SpawnSyncOptionsWithStringEncoding, spawnSync } from "node:child_process";
import { err, ok } from "neverthrow";
import type { AppResult } from "./fs.js";

type RunOptions = Omit<SpawnSyncOptionsWithStringEncoding, "encoding" | "stdio">;

export function runCommand(command: string, args: string[], options: RunOptions = {}): AppResult<string> {
    const result = spawnSync(command, args, {
        encoding: "utf8",
        stdio: "pipe",
        ...options,
    });

    if (result.status !== 0) {
        const output = (result.stderr || result.stdout || `${command} failed`).trim();
        return err(output);
    }

    return ok(result.stdout);
}
