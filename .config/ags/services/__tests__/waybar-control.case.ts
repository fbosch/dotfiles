import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { showWaybar } from "@/services/waybar-control";
import { assert, test } from "../../scripts/tests/gjs/harness";

const CHILD_MODE = GLib.getenv("WAYBAR_CONTROL_TEST_MODE");
const CHILD_TIMEOUT_MS = 1_000;

type ChildOutput = {
	stderr: string;
	stdout: string;
};

type Fixture = {
	home: string;
	request: string;
};

if (CHILD_MODE) {
	await runChild(CHILD_MODE);
} else {
	test("Waybar control sends show to the configured controller", async () => {
		await withFixture("exit 0", async ({ home, request }) => {
			const result = await runControlInChild(home, "success");
			assert(countFailures(result.stderr) === 0, "successful control request reported an error");
			assert(readFile(request) === "show\n", "controller did not receive exactly one show argument");
		});
	});

	test("Waybar control reports a synchronous spawn failure once", async () => {
		await withTemporaryHome(async (home) => {
			const result = await runControlInChild(home, "spawn-failure");
			assert(countFailures(result.stderr) === 1, "spawn failure was not reported exactly once");
		});
	});

	test("Waybar control reports an asynchronous nonzero failure once", async () => {
		await withFixture("exit 1", async ({ home }) => {
			const result = await runControlInChild(home, "nonzero-failure");
			assert(countFailures(result.stderr) === 1, "nonzero child failure was not reported exactly once");
		});
	});
}

async function runChild(mode: string): Promise<void> {
	showWaybar();

	if (mode === "success") {
		await waitFor(() =>
			Gio.File.new_for_path(`${GLib.get_home_dir()}/request`).query_exists(null),
		);
	} else {
		await delay(100);
	}

	console.log("WAYBAR_CONTROL_RESULT");
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
			resolve();
			return GLib.SOURCE_REMOVE;
		});
	});
}

async function runControlInChild(home: string, mode: string): Promise<ChildOutput> {
	const ags = GLib.find_program_in_path("ags");
	assert(ags !== null, "ags executable is unavailable");

	const launcher = new Gio.SubprocessLauncher({
		flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
	});
	launcher.setenv("HOME", home, true);
	launcher.setenv("WAYBAR_CONTROL_TEST_MODE", mode, true);
	launcher.set_cwd(GLib.canonicalize_filename("../../..", GLib.get_current_dir()));
	const process = launcher.spawnv([
		ags,
		"run",
		"--gtk",
		"4",
		"services/__tests__/waybar-control.case.ts",
	]);
	const output = await communicate(process);
	assert(
		`${output.stdout}\n${output.stderr}`.includes("WAYBAR_CONTROL_RESULT"),
		`child did not report its result: ${output.stdout}${output.stderr}`,
	);
	return output;
}

function communicate(process: Gio.Subprocess): Promise<ChildOutput> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CHILD_TIMEOUT_MS, () => {
			if (settled) return GLib.SOURCE_REMOVE;
			settled = true;
			process.force_exit();
			reject(new Error("child Waybar control test timed out"));
			return GLib.SOURCE_REMOVE;
		});

		process.communicate_utf8_async(
			null,
			null,
			(_source: Gio.Subprocess | null, result: Gio.AsyncResult) => {
				if (settled) return;
				settled = true;
				GLib.source_remove(timeoutId);
				try {
					const [ok, stdout, stderr] = process.communicate_utf8_finish(result);
					if (!ok || !process.get_successful()) {
						reject(new Error(`child Waybar control test failed: ${stderr}`));
						return;
					}
					resolve({ stderr: stderr ?? "", stdout: stdout ?? "" });
				} catch (cause) {
					reject(cause);
				}
			},
		);
	});
}

function countFailures(stderr: string): number {
	return stderr.split("Waybar control request failed:").length - 1;
}

async function waitFor(condition: () => boolean): Promise<void> {
	const deadline = GLib.get_monotonic_time() + CHILD_TIMEOUT_MS * 1_000;
	while (!condition()) {
		if (GLib.get_monotonic_time() > deadline) throw new Error("timed out waiting for Waybar control");
		await new Promise<void>((resolve) => {
			GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5, () => {
				resolve();
				return GLib.SOURCE_REMOVE;
			});
		});
	}
}

async function withFixture(body: string, run: (fixture: Fixture) => Promise<void>): Promise<void> {
	await withTemporaryHome(async (home) => {
		const script = GLib.build_filenamev([
			home,
			".config",
			"hypr",
			"runtime",
			"desktop",
			"waybar-control.sh",
		]);
		const request = `${home}/request`;
		GLib.mkdir_with_parents(GLib.path_get_dirname(script), 0o700);
		Gio.File.new_for_path(script).replace_contents(
			new TextEncoder().encode(`#!/bin/sh\nprintf '%s\\n' "$@" > "$HOME/request"\n${body}\n`),
			null,
			false,
			Gio.FileCreateFlags.PRIVATE,
			null,
		);
		GLib.chmod(script, 0o700);
		await run({ home, request });
	});
}

async function withTemporaryHome(run: (home: string) => Promise<void>): Promise<void> {
	const home = GLib.dir_make_tmp("waybar-control-home-XXXXXX");
	try {
		await run(home);
	} finally {
		removeTree(Gio.File.new_for_path(home));
	}
}

function readFile(path: string): string {
	const [ok, contents] = Gio.File.new_for_path(path).load_contents(null);
	if (!ok) throw new Error(`could not read ${path}`);
	return new TextDecoder().decode(contents);
}

function removeTree(file: Gio.File): void {
	let enumerator: Gio.FileEnumerator | null = null;
	try {
		enumerator = file.enumerate_children(
			"standard::name",
			Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
			null,
		);
		while (true) {
			const info = enumerator.next_file(null);
			if (!info) break;
			removeTree(file.get_child(info.get_name()));
		}
	} catch {
		// Regular files have no children.
	} finally {
		enumerator?.close(null);
	}
	file.delete(null);
}
