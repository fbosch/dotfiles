import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { err, ok } from "neverthrow";
import { dockStart, validStart, workdayStart } from "../workday_start.ts";

const directories = [];
afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(time = "09:59:00") {
    const now = new Date(`2026-10-30T${time}`);
    const cacheBase = mkdtempSync(join(tmpdir(), "workday-start-"));
    directories.push(cacheBase);
    mkdirSync(join(cacheBase, "first_login"));
    const file = join(cacheBase, "first_login", "26-10-30");
    return { now, cacheBase, file };
}

const loginEvents = [
    "2026-10-30 09:04:27.933 loginwindow Desktop showing",
    "2026-10-30 09:04:00.735 loginwindow Desktop showing",
].join("\n");

test("repairs the future overnight cache using today's earliest unlock", () => {
    const options = fixture();
    writeFileSync(options.file, "12:59:49\n");
    const result = workdayStart({ ...options, run: (command) => {
        expect(command).toBe("/usr/bin/log");
        return ok(loginEvents);
    } });
    expect(result._unsafeUnwrap()).toBe("09:04:00");
    expect(readFileSync(options.file, "utf8")).toBe("09:04:00\n");
});

test("an overnight lookup never assigns yesterday's Dock to today", () => {
    const options = fixture("00:46:15");
    const run = (command) => {
        if (command === "pgrep") return ok("123\n");
        if (command === "ps") return ok("Thu Oct 29 12:59:49 2026\n");
        return ok("");
    };
    expect(workdayStart({ ...options, run }).isErr()).toBe(true);
    expect(existsSync(options.file)).toBe(false);
    expect(workdayStart({ ...options, now: new Date("2026-10-30T09:59:00"), run: () => ok(loginEvents) })._unsafeUnwrap()).toBe("09:04:00");
});

test("a valid manual correction is preserved without querying logs", () => {
    const options = fixture();
    writeFileSync(options.file, "8:50:00\n");
    const result = workdayStart({ ...options, run: () => { throw new Error("unexpected detection"); } });
    expect(result._unsafeUnwrap()).toBe("08:50:00");
});

test("today's Dock remains a supported fallback when logs are unavailable", () => {
    const options = fixture();
    const result = workdayStart({ ...options, run: (command) => {
        if (command === "pgrep") return ok("123\n");
        if (command === "ps") return ok("Fri Oct 30 09:48:41 2026\n");
        return err("unavailable");
    } });
    expect(result._unsafeUnwrap()).toBe("09:48:41");
});

test("display fallback only considers today's past display-on events", () => {
    const options = fixture();
    const result = workdayStart({ ...options, run: (command) => command === "pmset" ? ok([
        "2026-10-29 07:00:00 +0100 Display is turned on",
        "2026-10-30 15:00:00 +0100 Display is turned on",
        "2026-10-30 08:55:00 +0100 Display is turned on",
    ].join("\n")) : err("unavailable") });
    expect(result._unsafeUnwrap()).toBe("08:55:00");
});

test("invalid cache and unavailable events fail without writing a guessed start", () => {
    const options = fixture();
    writeFileSync(options.file, "25:99:00\n");
    expect(workdayStart({ ...options, run: () => err("unavailable") }).isErr()).toBe(true);
    expect(readFileSync(options.file, "utf8")).toBe("25:99:00\n");
});

test("timestamp validation rejects future times and dates", () => {
    const now = new Date("2026-10-30T09:59:00");
    expect(validStart("12:59:49", now)).toBeUndefined();
    expect(dockStart("Thu Oct 29 08:00:00 2026", now)).toBeUndefined();
    expect(dockStart("Fri Oct 30 12:59:49 2026", now)).toBeUndefined();
    expect(dockStart("invalid", now)).toBeUndefined();
});

for (const silent of [false, true]) {
    test(`installed symlink resolves the helper independently of cwd (silent=${silent})`, () => {
        const { cacheBase } = fixture();
        const source = fileURLToPath(new URL("../../functions/first_login_of_the_day.fish", import.meta.url));
        const runtime = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
        const installed = join(cacheBase, "installed", "first_login_of_the_day.fish");
        const bin = join(cacheBase, "bin");
        mkdirSync(dirname(installed), { recursive: true });
        mkdirSync(bin);
        symlinkSync(source, installed);
        writeFileSync(join(bin, "bun"), `#!/bin/sh
test "$1" = --cwd && test "$2" = '${runtime}' && test "$3" = '${runtime}/workday_start.ts' || exit 42
printf '09:04:00\\n'
`, { mode: 0o755 });
        const result = spawnSync("fish", ["--no-config", "-c", `source "$argv[1]"; first_login_of_the_day ${silent ? "--silent" : ""}`, "--", installed], {
            cwd: cacheBase,
            env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
            encoding: "utf8",
        });
        expect(result.stderr).toBe("");
        expect(result.status).toBe(0);
        expect(result.stdout).toBe(silent ? "" : "09:04:00\n");
    });
}
