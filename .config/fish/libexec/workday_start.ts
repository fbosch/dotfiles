import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { err, ok, Result } from "neverthrow";
import { z } from "zod";
import { type AppResult, cacheRoot } from "./shared/fs.js";
import { runCommand } from "./shared/process.js";

const timeSchema = z.string().regex(/^\d{1,2}:[0-5]\d:[0-5]\d$/);
type Runner = typeof runCommand;

function dayKey(now: Date): string {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function validStart(value: string, now: Date): string | undefined {
    if (!timeSchema.safeParse(value).success) return undefined;
    const [hour, minute, second] = value.split(":").map(Number);
    const elapsed = hour * 3600 + minute * 60 + second;
    const current = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    return hour < 24 && elapsed <= current ? value.padStart(8, "0") : undefined;
}

export function dockStart(output: string, now: Date): string | undefined {
    const timestamp = new Date(output.trim());
    // A long-lived Dock belongs to its original login day, not today's workday.
    if (dayKey(timestamp) !== dayKey(now)) return undefined;
    const time = output.match(/\d{2}:\d{2}:\d{2}/);
    if (!time) return undefined;
    return validStart(time[0], now);
}

function eventStart(output: string, marker: RegExp, now: Date): string | undefined {
    return output
        .split("\n")
        .filter((line) => line.startsWith(`${dayKey(now)} `) && marker.test(line))
        .map((line) => validStart(line.slice(11, 19), now))
        .filter((time): time is string => time !== undefined)
        .sort()[0];
}

function readCachedStart(file: string, now: Date): AppResult<string | undefined> {
    return Result.fromThrowable(() => readFileSync(file, "utf8").trim())()
        .map((value) => validStart(value, now))
        .orElse((error) => {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") return ok(undefined);
            return err(`Cannot read workday cache: ${String(error)}`);
        });
}

function detectDockStart(now: Date, run: Runner): string | undefined {
    const pid = run("pgrep", ["-u", String(process.getuid?.() ?? ""), "-x", "Dock"])
        .unwrapOr("")
        .trim()
        .split("\n")[0];
    if (!pid) return undefined;
    const started = run("ps", ["-p", pid, "-o", "lstart="], { env: { ...process.env, LC_ALL: "C" } });
    return dockStart(started.unwrapOr(""), now);
}

function detectStart(now: Date, run: Runner): string | undefined {
    const login = run(
        "/usr/bin/log",
        [
            "show",
            "--style",
            "compact",
            "--start",
            `${dayKey(now)} 00:00:00`,
            "--predicate",
            'process == "loginwindow" AND eventMessage CONTAINS "systemSetSessionState success, new state: Desktop showing"',
        ],
        { timeout: 30000 },
    );
    const desktop = eventStart(login.unwrapOr(""), /Desktop showing/, now);
    if (desktop) return desktop;
    const dock = detectDockStart(now, run);
    if (dock) return dock;
    const display = run("pmset", ["-g", "log"], { timeout: 30000 });
    return eventStart(display.unwrapOr(""), /Display.*(?:turned on|is on)/, now);
}

function writeStart(cacheFile: string, start: string): AppResult<string> {
    return Result.fromThrowable(
        () => {
            mkdirSync(dirname(cacheFile), { recursive: true });
            const temporary = `${cacheFile}.${process.pid}.tmp`;
            writeFileSync(temporary, `${start}\n`, { mode: 0o600 });
            renameSync(temporary, cacheFile);
            return start;
        },
        (error) => `Cannot write workday cache: ${String(error)}`,
    )();
}

type Options = { now?: Date; cacheBase?: string; run?: Runner };

export function workdayStart({
    now = new Date(),
    cacheBase = cacheRoot(),
    run = runCommand,
}: Options = {}): AppResult<string> {
    const cacheFile = join(cacheBase, "first_login", dayKey(now).slice(2));
    const cached = readCachedStart(cacheFile, now);
    if (cached.isErr()) return err(cached.error);
    if (cached.value) return ok(cached.value);
    const start = detectStart(now, run);
    if (!start) return err("No workday start event found for today");
    return writeStart(cacheFile, start);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    const result = workdayStart();
    if (result.isErr()) {
        console.error(result.error);
        process.exitCode = 1;
    } else {
        console.log(result.value);
    }
}
