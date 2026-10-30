// fallow-ignore-file unused-file
// Bun discovers this file by its test filename rather than a production import.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAccountProfile, loadAccountAliases } from "../../shared/account_profile.js";

const helper = fileURLToPath(new URL("../reset_helper.ts", import.meta.url));
const wrapper = fileURLToPath(new URL("../../../functions/codex-reset.fish", import.meta.url));

function fixture(callback) {
    const root = mkdtempSync(join(tmpdir(), "codex-reset-test-"));
    try {
        return callback(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

test("Codex aliases supply account display names", () => fixture((root) => {
    const directory = join(root, "fbb", "data", "codex");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "account-aliases.json"), JSON.stringify({ openai: { "ember-falcon-abcd": "primary" } }));
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = root;
    try {
        const aliases = loadAccountAliases();
        expect(aliases.isOk()).toBe(true);
        if (aliases.isOk()) {
            expect(buildAccountProfile("openai", "00-00-00-abcd", aliases.value).shortLabel).toBe("primary");
        }
    } finally {
        if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
        else process.env.XDG_CONFIG_HOME = previous;
    }
}));

test("native helper rejects invalid arguments without loading credentials or making requests", () => {
    const result = spawnSync("bun", [helper, "consume", "--refresh"], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unknown or invalid option: --refresh");
});

test("Fish status and dry-run consume use the native helper JSON contract", () => fixture((root) => {
    const bin = join(root, "bin");
    mkdirSync(bin);
    const calls = join(root, "calls");
    const mock = join(bin, "bun");
    writeFileSync(mock, `#!/bin/sh
printf '%s\\n' "$*" >> "$CODEX_RESET_TEST_CALLS"
case " $* " in
  *' consume-preview '*) printf '%s\\n' '{"credit":{"id":"credit-1","title":"Reset credit","resetType":"manual","grantedAt":"today","expiresAt":"tomorrow","expiresIn":"1d","urgency":"soon"}}' ;;
  *' status '*) printf '%s\\n' '{"active":{"profileLabel":"primary","availableCount":0,"credits":[],"usage":[]},"accounts":[]}' ;;
  *) exit 8 ;;
esac
`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CODEX_RESET_TEST_CALLS: calls };
    const run = (action) => spawnSync("fish", ["--no-config", "-c", `source ${wrapper}; codex-reset ${action}`], { encoding: "utf8", env });
    const status = run("status");
    expect(status.status, status.stderr).toBe(0);
    expect(status.stdout).toContain("banked reset credits: 0 available (primary)");
    const preview = run("consume --dry-run");
    expect(preview.status).toBe(0);
    expect(preview.stdout).toContain("Dry run: no reset was redeemed.");
    expect(readFileSync(calls, "utf8")).toContain("consume-preview");
}));
