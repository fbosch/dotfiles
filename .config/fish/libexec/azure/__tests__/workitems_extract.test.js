// fallow-ignore-file unused-file
// Bun discovers this file by its test filename rather than a production import.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const helperPath = fileURLToPath(new URL("../workitems_extract.ts", import.meta.url));

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { encoding: "utf8", ...options });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(command + " " + args.join(" ") + " failed:\n" + result.stderr);
    }

    return result.stdout.trim();
}

function git(repo, ...args) {
    return run("git", ["-C", repo, ...args]);
}

function withRepo(callback) {
    const root = mkdtempSync(join(tmpdir(), "workitems-extract-test-"));
    const repo = join(root, "repo");
    mkdirSync(repo);

    try {
        run("git", ["init", "--initial-branch=main", repo]);
        git(repo, "config", "user.name", "Workitems Test");
        git(repo, "config", "user.email", "workitems-test@example.com");
        return callback({ repo, root });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function commit(repo, subject, date) {
    appendFileSync(join(repo, "history.txt"), subject + "\n");
    git(repo, "add", "history.txt");
    run("git", ["-C", repo, "commit", "-m", subject], {
        env: {
            ...process.env,
            GIT_AUTHOR_DATE: date + "T12:00:00+00:00",
            GIT_COMMITTER_DATE: date + "T12:00:00+00:00",
        },
    });
}

function extract(repo, root, startDate, endDate) {
    const output = run("bun", [helperPath, startDate, endDate, "authored_branches", "1"], {
        cwd: repo,
        env: {
            ...process.env,
            FISH_LIBEXEC_CWD: repo,
            XDG_CACHE_HOME: join(root, "cache"),
            TZ: "UTC",
        },
    });

    return output ? output.split(/\r?\n/) : [];
}

test("does not assign a shared commit to several issue branches", () =>
    withRepo(({ repo, root }) => {
        commit(repo, "chore: shared planning update", "2020-10-19");
        for (const workitem of ["61513", "61514", "61546", "61547"]) {
            git(repo, "branch", "fix/" + workitem + "-work");
        }

        expect(extract(repo, root, "2020-10-19", "2020-10-19")).toEqual([]);
    }));

test("keeps branch inference when containing refs agree on one item", () =>
    withRepo(({ repo, root }) => {
        commit(repo, "chore: baseline", "2020-10-18");
        git(repo, "branch", "fix/61513-triaged-errors");
        git(repo, "checkout", "fix/61513-triaged-errors");
        commit(repo, "fix: handle triaged errors", "2020-10-19");

        expect(extract(repo, root, "2020-10-19", "2020-10-19")).toEqual([
            "2020-10-19|61513|fix/61513-triaged-errors",
        ]);
    }));

test("keeps work-item IDs explicitly present in commit subjects", () =>
    withRepo(({ repo, root }) => {
        commit(repo, "fix(AB#61547): sync filters", "2020-10-19");
        git(repo, "branch", "fix/61513-triaged-errors");
        git(repo, "branch", "fix/61547-dashboard-filtering");

        const records = extract(repo, root, "2020-10-19", "2020-10-19");
        expect(records.map((record) => record.split("|").slice(0, 2).join("|"))).toEqual([
            "2020-10-19|61547",
        ]);
    }));
