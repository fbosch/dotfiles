import { type SpawnSyncOptionsWithStringEncoding, spawnSync } from "node:child_process";

export type AppResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: string };

type RunOptions = Omit<SpawnSyncOptionsWithStringEncoding, "encoding" | "stdio">;

export function ok<T>(value: T): AppResult<T> {
    return { ok: true, value };
}

export function err<T = never>(error: string): AppResult<T> {
    return { ok: false, error };
}

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

export function runJson<T>(command: string, args: string[], options: RunOptions = {}): AppResult<T> {
    const commandResult = runCommand(command, args, options);
    if (commandResult.ok === false) {
        return commandResult;
    }

    try {
        return ok(JSON.parse(commandResult.value) as T);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(`Invalid JSON response: ${message}`);
    }
}
