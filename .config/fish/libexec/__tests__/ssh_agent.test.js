import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { delimiter, join, resolve } from "node:path";

const helper = resolve(import.meta.dir, "../ssh_agent.ts");
const fishInit = resolve(import.meta.dir, "../../ssh_agent.fish");
const fixtures = [];
afterEach(async () => {
	for (const f of fixtures.splice(0)) {
		await Promise.all(
			f.servers.map((server) => new Promise((done) => server.close(done))),
		);
		rmSync(f.root, { recursive: true, force: true });
	}
});

async function fixture(localIdentities = []) {
	const root = mkdtempSync("/tmp/fish-ssh-");
	const bin = join(root, "bin");
	const local = join(root, "local.sock");
	const forwarded = join(root, "forwarded.sock");
	const stateFile = join(root, "agents.json");
	const log = join(root, "calls.jsonl");
	const key = join(root, ".ssh", "id_rsa");
	mkdirSync(bin);
	mkdirSync(join(root, ".ssh"));
	writeFileSync(
		key,
		"synthetic private key, never passed to a real SSH command",
	);
	writeFileSync(`${key}.pub`, "synthetic public key");
	const state = {
		[local]: { identities: localIdentities },
		[forwarded]: { identities: [] },
	};
	writeFileSync(stateFile, JSON.stringify(state));
	writeFileSync(
		join(bin, "ssh-add"),
		`#!${process.execPath}
const fs = require("node:fs");
const state = JSON.parse(fs.readFileSync(process.env.FIXTURE_STATE, "utf8"));
const socket = process.env.SSH_AUTH_SOCK;
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ socket, args }) + "\\n");
const agent = state[socket];
if (!agent || agent.unreachable) process.exit(2);
if (args[0] === "-l") {
    if (!agent.identities.length) process.exit(1);
    console.log(agent.identities.map(key => "2048 " + key + " fixture (RSA)").join("\\n"));
} else {
    if (agent.failLoad) process.exit(1);
    agent.identities.push("SHA256:fixtureRSA");
    fs.writeFileSync(process.env.FIXTURE_STATE, JSON.stringify(state));
}
`,
		{ mode: 0o700 },
	);
	writeFileSync(
		join(bin, "ssh-keygen"),
		`#!${process.execPath}\nconsole.log("2048 SHA256:fixtureRSA fixture (RSA)");\n`,
		{ mode: 0o700 },
	);
	const servers = [];
	for (const socket of [local, forwarded]) {
		const server = createServer();
		servers.push(server);
		server.listen(socket);
		await once(server, "listening");
	}
	const env = {
		HOME: root,
		PATH: bin + delimiter + process.env.PATH,
		TERM: "xterm",
		FIXTURE_STATE: stateFile,
		FIXTURE_LOG: log,
	};
	const calls = () =>
		existsSync(log)
			? readFileSync(log, "utf8")
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line))
			: [];
	const f = {
		root,
		local,
		forwarded,
		key,
		state,
		servers,
		env,
		calls,
		save: () => writeFileSync(stateFile, JSON.stringify(state)),
		run: (inherited = "") =>
			spawnSync(process.execPath, [helper, inherited, local, key], {
				env,
				encoding: "utf8",
			}),
	};
	fixtures.push(f);
	return f;
}

test("a dangling Herdr/WezTerm socket recovers to the managed agent and loads RSA", async () => {
	const f = await fixture();
	const stale = join(f.root, "herdr.sock.agent");
	symlinkSync(join(f.root, "vanished-wezterm.sock"), stale);
	const result = f.run(stale);
	expect(result.status).toBe(0);
	expect(result.stdout.trim()).toBe(f.local);
	expect(f.calls().filter((call) => call.args[0] === "-q")).toEqual([
		{ socket: f.local, args: ["-q", f.key] },
	]);
});

test("working forwarded agents, including empty agents, stay untouched", async () => {
	const f = await fixture();
	const result = f.run(f.forwarded);
	expect(result.status).toBe(0);
	expect(result.stdout.trim()).toBe(f.forwarded);
	expect(f.calls()).toEqual([{ socket: f.forwarded, args: ["-l"] }]);
});

test("an unresponsive inherited agent falls back despite its socket file existing", async () => {
	const f = await fixture();
	f.state[f.forwarded].unreachable = true;
	f.save();
	const result = f.run(f.forwarded);
	expect(result.status).toBe(0);
	expect(result.stdout.trim()).toBe(f.local);
});

test("an already-loaded RSA key is not loaded or prompted for again", async () => {
	const f = await fixture(["SHA256:fixtureRSA"]);
	expect(f.run(f.local).status).toBe(0);
	expect(f.calls().filter((call) => call.args[0] === "-q")).toHaveLength(0);
});

test("other loaded identities do not prevent the configured RSA key from loading", async () => {
	const f = await fixture(["SHA256:anotherKey"]);
	expect(f.run().status).toBe(0);
	expect(f.calls().filter((call) => call.args[0] === "-q")).toHaveLength(1);
});

test("a stable Herdr alias to the managed socket is preserved and gets local RSA loading", async () => {
	const f = await fixture();
	const alias = join(f.root, "herdr.sock.agent");
	symlinkSync(f.local, alias);
	f.state[alias] = f.state[f.local];
	f.save();
	const result = f.run(alias);
	expect(result.status).toBe(0);
	expect(result.stdout.trim()).toBe(alias);
	expect(f.calls().filter((call) => call.args[0] === "-q")[0].socket).toBe(
		alias,
	);
});

test("failed key loading reports failure while still publishing the working local socket", async () => {
	const f = await fixture();
	f.state[f.local].failLoad = true;
	f.save();
	const result = f.run();
	expect(result.status).toBe(1);
	expect(result.stdout.trim()).toBe(f.local);
	expect(result.stderr).toContain("Cannot load SSH identity");
});

test("a missing public key is reported without an ambiguous identity or repeated private-key prompt", async () => {
	const f = await fixture();
	rmSync(`${f.key}.pub`);
	const result = f.run();
	expect(result.status).toBe(1);
	expect(result.stderr).toContain("SSH public key is missing");
	expect(f.calls().filter((call) => call.args[0] === "-q")).toHaveLength(0);
});

function installFishBridge(f) {
	const config = join(f.root, ".config");
	mkdirSync(join(config, "nix"), { recursive: true });
	mkdirSync(join(config, "fish"));
	symlinkSync(resolve(import.meta.dir, ".."), join(config, "fish", "libexec"));
	symlinkSync(fishInit, join(config, "fish", "ssh_agent.fish"));
	writeFileSync(
		join(config, "nix", "ssh-agent.fish"),
		`set -x SSH_AUTH_SOCK "${f.local}"\n`,
	);
	return join(config, "fish", "ssh_agent.fish");
}

test("interactive Fish adopts the selected agent and loads the key just once", async () => {
	const f = await fixture();
	const bridge = installFishBridge(f);
	const result = spawnSync(
		"fish",
		[
			"--no-config",
			"-i",
			"-c",
			'source "$FISH_AGENT_INIT"; source "$FISH_AGENT_INIT"; printf "%s\\n" "$SSH_AUTH_SOCK"',
		],
		{
			env: {
				...f.env,
				FISH_AGENT_INIT: bridge,
				SSH_AUTH_SOCK: join(f.root, "stale.sock"),
			},
			encoding: "utf8",
		},
	);
	expect(result.status).toBe(0);
	expect(result.stdout.trim()).toBe(f.local);
	expect(f.calls().filter((call) => call.args[0] === "-q")).toHaveLength(1);
});

for (const mode of ["noninteractive", "sandboxed"]) {
	test(`${mode} Fish never loads private keys or changes the agent`, async () => {
		const f = await fixture();
		const bridge = installFishBridge(f);
		const result = spawnSync(
			"fish",
			[
				"--no-config",
				...(mode === "sandboxed" ? ["-i"] : []),
				"-c",
				'source "$FISH_AGENT_INIT"; printf "%s\\n" "$SSH_AUTH_SOCK"',
			],
			{
				env: {
					...f.env,
					FISH_AGENT_INIT: bridge,
					SSH_AUTH_SOCK: f.forwarded,
					...(mode === "sandboxed"
						? { NONO_CAP_FILE: "/fixture/capabilities" }
						: {}),
				},
				encoding: "utf8",
			},
		);
		expect(result.status).toBe(0);
		expect(result.stdout.trim()).toBe(f.forwarded);
		expect(f.calls()).toHaveLength(0);
	});
}
