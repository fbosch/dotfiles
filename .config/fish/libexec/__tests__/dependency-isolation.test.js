import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

const manifest = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const configuration = readFileSync(
	new URL("../bunfig.toml", import.meta.url),
	"utf8",
);
const roots = [];
afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

test("Fish helpers do not auto-install hard-linked dependencies at runtime", () => {
	expect(Bun.TOML.parse(configuration).install.auto).toBe("disable");
});

test("explicit Fish dependency install uses independent copies without changing the lockfile", () => {
	expect(typeof manifest.scripts["install:deps"]).toBe("string");
	const root = mkdtempSync(join(tmpdir(), "fish-dependency-isolation-"));
	roots.push(root);
	const source = join(root, "package");
	const app = join(root, "app");
	const cache = join(root, "cache");
	for (const directory of [source, app, cache]) mkdirSync(directory);
	writeFileSync(
		join(source, "package.json"),
		JSON.stringify({ name: "local-shell-helper-fixture", version: "1.0.0" }),
	);
	writeFileSync(join(source, "index.js"), 'module.exports = "fixture";\n');
	writeFileSync(
		join(app, "package.json"),
		JSON.stringify({
			name: "fish-install-fixture",
			private: true,
			dependencies: { "local-shell-helper-fixture": "file:../fixture.tgz" },
			scripts: { "install:deps": manifest.scripts["install:deps"] },
		}),
	);
	writeFileSync(join(app, "bunfig.toml"), configuration);
	const environment = {
		HOME: root,
		TMPDIR: root,
		PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`,
	};
	const run = (command, args) => {
		const result = spawnSync(command, args, {
			cwd: app,
			env: environment,
			encoding: "utf8",
			timeout: 15000,
		});
		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr || result.stdout).toBe(0);
	};
	// A local tarball exercises Bun's real cache backend without registry access or lifecycle scripts.
	run("tar", ["-czf", join(root, "fixture.tgz"), "-C", root, "package"]);
	const offline = ["--offline", "--ignore-scripts", "--cache-dir", cache];
	run(process.execPath, ["install", "--lockfile-only", ...offline]);
	const lock = readFileSync(join(app, "bun.lock"));
	run(process.execPath, ["run", "install:deps", ...offline]);
	const installed = join(app, "node_modules", "local-shell-helper-fixture", "index.js");
	expect(statSync(installed).nlink).toBe(1);
	expect(readFileSync(installed, "utf8")).toBe('module.exports = "fixture";\n');
	expect(readFileSync(join(app, "bun.lock"))).toEqual(lock);
});
