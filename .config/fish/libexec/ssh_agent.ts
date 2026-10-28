#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { err, fromThrowable, ok, type Result } from "neverthrow";
import { z } from "zod";

const absolutePath = z
	.string()
	.refine((value) => isAbsolute(value) && !/[\r\n]/.test(value));
const argumentSchema = z.tuple([z.string(), absolutePath, absolutePath]);

type Socket = { path: string; device: number; inode: number };
type Agent = Socket & { identities: string };

function socketAt(path: string): Result<Socket, Error> {
	return fromThrowable(
		() => {
			if (!isAbsolute(path) || /[\r\n]/.test(path))
				throw new Error("Invalid SSH agent socket path.");
			const entry = statSync(path);
			if (!entry.isSocket()) throw new Error("SSH agent path is not a socket.");
			return { path, device: entry.dev, inode: entry.ino };
		},
		() => new Error(`Cannot access SSH agent socket: ${path}`),
	)();
}

function queryAgent(path: string): Result<Agent, Error> {
	return socketAt(path).andThen((socket) => {
		const result = spawnSync("ssh-add", ["-l"], {
			env: { ...process.env, SSH_AUTH_SOCK: path },
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 2000,
		});
		// OpenSSH returns 1 for a reachable empty agent and 2 for no agent.
		if (result.error || (result.status !== 0 && result.status !== 1)) {
			return err(new Error(`Cannot connect to SSH agent: ${path}`));
		}
		return ok({ ...socket, identities: result.stdout });
	});
}

function publicKeyFingerprint(publicKey: string): Result<string, Error> {
	if (!existsSync(publicKey))
		return err(new Error(`SSH public key is missing: ${publicKey}`));
	const result = spawnSync(
		"ssh-keygen",
		["-E", "sha256", "-l", "-f", publicKey],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 2000 },
	);
	if (result.status !== 0)
		return err(
			new Error(`Cannot read SSH public-key fingerprint: ${publicKey}`),
		);
	const fingerprint = /\bSHA256:[A-Za-z0-9+/]+={0,2}(?=\s|$)/.exec(
		result.stdout,
	);
	if (!fingerprint)
		return err(
			new Error(`Cannot read SSH public-key fingerprint: ${publicKey}`),
		);
	return ok(fingerprint[0]);
}

function addIdentity(socket: string, key: string): Result<void, Error> {
	// Interactive host startup may prompt on the TTY for an encrypted key.
	const result = spawnSync("ssh-add", ["-q", key], {
		env: { ...process.env, SSH_AUTH_SOCK: socket },
		stdio: ["inherit", "ignore", "inherit"],
	});
	return result.status === 0
		? ok(undefined)
		: err(new Error(`Cannot load SSH identity: ${key}`));
}

function loadIdentity(agent: Agent, key: string): Result<void, Error> {
	if (!existsSync(key)) return ok(undefined);
	return publicKeyFingerprint(`${key}.pub`).andThen((fingerprint) => {
		if (agent.identities.split(/\s+/).includes(fingerprint))
			return ok(undefined);
		return addIdentity(agent.path, key);
	});
}

function selectAgent(
	inheritedPath: string,
	localPath: string,
): Result<Agent, Error> {
	if (!inheritedPath) return queryAgent(localPath);
	return queryAgent(inheritedPath).orElse(() => queryAgent(localPath));
}

function isLocalAgent(agent: Agent, localPath: string): boolean {
	return socketAt(localPath).match(
		(local) => local.device === agent.device && local.inode === agent.inode,
		() => false,
	);
}

function main(): void {
	const [inheritedPath, localPath, key] = argumentSchema.parse(
		process.argv.slice(2),
	);
	const selected = selectAgent(inheritedPath, localPath);
	if (selected.isErr()) throw selected.error;
	process.stdout.write(`${selected.value.path}\n`);

	// Preserve working forwarded agents without adding local private keys to them.
	if (!isLocalAgent(selected.value, localPath)) return;
	loadIdentity(selected.value, key).mapErr((error) => {
		console.error(`SSH agent setup: ${error.message}`);
		process.exitCode = 1;
	});
}

try {
	main();
} catch (error) {
	console.error(
		`SSH agent setup: ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exitCode = 1;
}
