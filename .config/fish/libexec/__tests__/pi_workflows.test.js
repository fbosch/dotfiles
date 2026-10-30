import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots = [];
afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "pi-workflows-"));
    roots.push(root);
    const log = join(root, "arguments");
    const helperLog = join(root, "helper-arguments");
    const stub = (name, body) => writeFileSync(join(root, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    stub("wt", 'printf "%s\\0" "$@" > "$CALL_LOG"');
    for (const name of ["linear", "fzf", "pi"]) stub(name, "exit 0");
    stub("git", 'case "$*" in *rev-parse*) printf "%s\\n" "$TEST_REPO";; *show-ref*) exit "$BRANCH_RESULT";; esac');
    stub("bun", 'printf "%s\\0" "$@" > "$HELPER_LOG"; printf "%s\\n" feature/lin-123');
    const env = {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        CALL_LOG: log,
        HELPER_LOG: helperLog,
        TEST_REPO: root,
        BRANCH_RESULT: "0",
    };
    const args = () => readFileSync(log, "utf8").split("\0").slice(0, -1);
    return { root, stub, env, args, helperLog };
}

function run(source, invocation, env) {
    return spawnSync("fish", ["--no-config", "-c", `source "$WORKFLOW_SOURCE"; ${invocation}`], {
        env: { ...env, WORKFLOW_SOURCE: resolve(source) },
        encoding: "utf8",
    });
}

for (const existing of [true, false]) {
    test(`Linear starts Pi in ${existing ? "an existing" : "a new"} worktree`, () => {
        const f = fixture();
        f.env.BRANCH_RESULT = existing ? "0" : "1";
        const result = run(".config/fish/functions/linear_issue_workflow.fish", "linear_issue_workflow LIN-123", f.env);
        expect(result.stderr).toBe("");
        expect(result.status).toBe(0);
        expect(f.args()).toEqual([
            "-C", f.root, "switch", ...(existing ? [] : ["--create"]),
            "feature/lin-123", "--yes", "--execute=pi", "--", "--",
            "/skill:linear-issue-workflow LIN-123",
        ]);
        expect(readFileSync(f.helperLog, "utf8").split("\0").slice(0, -1)).toEqual([
            "--cwd", resolve(".config/fish/libexec"),
            resolve(".config/fish/libexec/linear/linear_issue_workflow_helper.ts"),
            "issue-branch", "LIN-123",
        ]);
    });
}

test("worktree creation loads direnv and preserves Pi argument boundaries", () => {
    const f = fixture();
    f.stub("direnv", "exit 0");
    const result = run(".config/fish/functions/wsc.fish", 'wsc feature/test --yes -- -- "prompt with spaces"', f.env);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(f.args()).toEqual([
        "switch", "--create", "--execute=direnv", "feature/test", "--yes", "--",
        "exec", "{{ worktree_path }}", "pi", "--", "prompt with spaces",
    ]);
});

test("worktree creation forwards Pi's exit status", () => {
    const f = fixture();
    f.stub("wt", "exit 17");
    const result = run(".config/fish/functions/wsc.fish", "wsc feature/test", f.env);
    expect(result.status).toBe(17);
});
