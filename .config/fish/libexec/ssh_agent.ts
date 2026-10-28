#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { err, fromThrowable, ok, type Result } from "neverthrow";
import { z } from "zod";

const absolutePath = z.string().refine((value) => isAbsolute(value) && !/[\r\n]/.test(value));
const argumentSchema = z.tuple([z.string(), absolutePath, absolutePath]);

type Socket = { path: string; device: number; inode: number };
type Agent = Socket & { identities: string };

function socketAt(path: string): Result<Socket, Error> {
    return fromThrowable(
        () => {
            if (!isAbsolute(path) || /[\r\n]/.test(path)) throw new Error("Invalid SSH agent socket path.");
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

function loadIdentity(agent: Agent, key: string): Result<void, Error> {
    if (!existsSync(key)) return ok(undefined);
    const publicKey = `${key}.pub`;
    if (!existsSync(publicKey)) return err(new Error(`SSH public key is missing: ${publicKey}`));
    const fingerprint = spawnSync("ssh-keygen", ["-E", "sha256", "-l", "-f", publicKey], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 2000,
    });
    const expected = fingerprint.stdout?.match(/\bSHA256:[A-Za-z0-9+/]+={0,2}(?=\s|$)/)?.[0];
    if (fingerprint.error || fingerprint.status !== 0 || !expected) {
        return err(new Error(`Cannot read SSH public-key fingerprint: ${publicKey}`));
    }
    if (agent.identities.split(/\s+/).includes(expected)) return ok(undefined);
    // Interactive host startup may prompt on the TTY for an encrypted key.
    const added = spawnSync("ssh-add", ["-q", key], {
        env: { ...process.env, SSH_AUTH_SOCK: agent.path },
        stdio: ["inherit", "ignore", "inherit"],
    });
    return !added.error && added.status === 0 ? ok(undefined) : err(new Error(`Cannot load SSH identity: ${key}`));
}

function main(): void {
    const [inheritedPath, localPath, key] = argumentSchema.parse(process.argv.slice(2));
    const inherited = inheritedPath ? queryAgent(inheritedPath) : err(new Error("No inherited SSH agent."));
    const selected = inherited.isOk() ? inherited : queryAgent(localPath);
    if (selected.isErr()) throw selected.error;
    process.stdout.write(`${selected.value.path}\n`);

    const local = socketAt(localPath);
    // Preserve working forwarded agents without adding local private keys to them.
    if (local.isErr() || local.value.device !== selected.value.device || local.value.inode !== selected.value.inode) return;
    const loaded = loadIdentity(selected.value, key);
    if (loaded.isErr()) {
        console.error(`SSH agent setup: ${loaded.error.message}`);
        process.exitCode = 1;
    }
}

try {
    main();
} catch (error) {
    console.error(`SSH agent setup: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
}
