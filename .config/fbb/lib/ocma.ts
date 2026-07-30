import { spawn } from "node:child_process";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import {
	type AccountDiscovery,
	acquireMutationLock,
	beginLogin,
	completeLogin,
	type Diagnostic,
	defaultPaths,
	discoverAccounts,
	type PublicAccountDiscovery,
	recoverPendingLogin,
	switchAccount,
	toPublicDiscovery,
} from "./opencode-multi-auth.ts";

const VERSION = "0.1.0";
const OUTPUT_SCHEMA = "fbb.ocma/v1";

type OutputFormat = "text" | "json";
type Outcome = "success" | "warning" | "error";

type CommandOutput<T> = {
	schema: typeof OUTPUT_SCHEMA;
	command: string;
	outcome: Outcome;
	data: T | null;
	diagnostics: Diagnostic[];
};

function printUsage(): void {
	console.log(`ocma ${VERSION}

OpenCode multi-account management.

Usage:
  ocma list [--format text|json]
  ocma status [--format text|json]
  ocma switch <alias-or-label> [--format text|json]
  ocma login [alias] [--format text|json]
  ocma help
  ocma --version

Aliases are stored in ~/.config/fbb/data/account-aliases.json.`);
}

const [command, ...args] = process.argv.slice(2);

if (
	command === undefined ||
	command === "help" ||
	command === "--help" ||
	command === "-h"
) {
	printUsage();
	process.exit(0);
}

if (command === "--version" || command === "-V") {
	console.log(VERSION);
	process.exit(0);
}

if (
	command === "list" ||
	command === "status" ||
	command === "switch" ||
	command === "login"
) {
	let format: OutputFormat = "text";
	try {
		format = formatFromArgs(args);
		const output = await runCommand(command, args, format);
		emitOutput(format, output);
		process.exit(exitCode(output.outcome));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const output = errorOutput(command, message);
		emitOutput(format, output);
		process.exit(exitCode(output.outcome));
	}
}

console.error(`ocma: unknown command: ${command}`);
console.error("Run 'ocma help' for usage.");
process.exit(2);

async function runCommand(
	command: "list" | "status" | "switch" | "login",
	args: string[],
	format: OutputFormat,
): Promise<CommandOutput<unknown>> {
	const positional = positionalArgs(args);
	if (command === "list" || command === "status") {
		if (positional.length > 0) {
			throw new Error(`ocma ${command}: does not accept positional arguments`);
		}
		const discovery = await discoverAccounts(defaultPaths());
		return successOutput(
			command,
			discovery,
			command === "list" ? listData(discovery) : statusData(discovery),
		);
	}

	if (command === "switch") {
		if (positional.length !== 1) {
			throw new Error("ocma switch: expected one alias or generated label");
		}
		const paths = defaultPaths();
		const lock = await acquireMutationLock(paths);
		try {
			await recoverPendingLogin(paths);
			const discovery = await switchAccount(positional[0], paths);
			return successOutput(command, discovery, statusData(discovery));
		} finally {
			await lock.release();
		}
	}

	if (positional.length > 1) {
		throw new Error("ocma login: expected zero or one alias");
	}
	const alias = positional[0] || (await promptForAlias(format));
	const paths = defaultPaths();
	const lock = await acquireMutationLock(paths);
	try {
		await recoverPendingLogin(paths);
		await beginLogin(alias, paths);
		try {
			await runOpenCodeLogin();
			const discovery = await completeLogin(paths);
			return successOutput(command, discovery, statusData(discovery));
		} catch (error) {
			await recoverPendingLogin(paths);
			throw error;
		}
	} finally {
		await lock.release();
	}
}

function formatFromArgs(args: string[]): OutputFormat {
	const formatIndex = args.indexOf("--format");
	if (formatIndex === -1) {
		return "text";
	}
	const format = args[formatIndex + 1];
	if (
		formatIndex + 1 >= args.length ||
		(format !== "text" && format !== "json") ||
		args.indexOf("--format", formatIndex + 1) !== -1
	) {
		throw new Error("expected --format text or --format json");
	}
	return format;
}

function positionalArgs(args: string[]): string[] {
	const positional: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === "--format") {
			index += 1;
			continue;
		}
		if (args[index].startsWith("--")) {
			throw new Error(`unknown option: ${args[index]}`);
		}
		positional.push(args[index]);
	}
	return positional;
}

async function promptForAlias(format: OutputFormat): Promise<string> {
	if (format === "json" || stdin.isTTY !== true) {
		throw new Error(
			"ocma login: an alias is required when stdin is not interactive",
		);
	}
	const readline = createInterface({ input: stdin, output: stdout });
	try {
		const alias = await readline.question("Alias for the new OpenAI account: ");
		if (alias.trim() === "") {
			throw new Error("ocma login: alias cannot be empty");
		}
		return alias;
	} finally {
		readline.close();
	}
}

async function runOpenCodeLogin(): Promise<void> {
	const child = spawn("opencode", ["auth", "login", "--provider", "openai"], {
		stdio: "inherit",
	});
	const exitCode = await new Promise<number>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code) => resolve(code ?? 1));
	});
	if (exitCode !== 0) {
		throw new Error(`OpenCode login exited with status ${exitCode}`);
	}
}

function successOutput<T>(
	command: string,
	discovery: AccountDiscovery,
	data: T,
): CommandOutput<T> {
	return {
		schema: OUTPUT_SCHEMA,
		command,
		outcome: discovery.diagnostics.length === 0 ? "success" : "warning",
		data,
		diagnostics: discovery.diagnostics,
	};
}

function errorOutput(command: string, message: string): CommandOutput<null> {
	return {
		schema: OUTPUT_SCHEMA,
		command,
		outcome: "error",
		data: null,
		diagnostics: [{ code: "account-discovery-failed", message }],
	};
}

function listData(discovery: AccountDiscovery): PublicAccountDiscovery {
	return toPublicDiscovery(discovery);
}

function statusData(discovery: AccountDiscovery): {
	active: PublicAccountDiscovery["profiles"][number] | null;
	profileCount: number;
} {
	const publicDiscovery = toPublicDiscovery(discovery);
	return {
		active: publicDiscovery.profiles.find((profile) => profile.active) || null,
		profileCount: publicDiscovery.profiles.length,
	};
}

function emitOutput(
	format: OutputFormat,
	output: CommandOutput<unknown>,
): void {
	if (format === "json") {
		console.log(JSON.stringify(output, null, 2));
		return;
	}

	if (output.outcome === "error") {
		printDiagnostics(output.diagnostics);
		return;
	}

	if (output.command === "list") {
		printAccounts(output.data as PublicAccountDiscovery);
	} else {
		printStatus(output.data as ReturnType<typeof statusData>);
	}
	printDiagnostics(output.diagnostics);
}

function exitCode(outcome: Outcome): number {
	return outcome === "success" ? 0 : 1;
}

function printAccounts(discovery: PublicAccountDiscovery): void {
	for (const profile of discovery.profiles) {
		const name = profile.alias || profile.generatedLabel || "unresolved";
		const state = profile.active ? "active" : "inactive";
		console.log(`${profile.key}\t${name}\t${state}`);
	}
}

function printStatus(status: ReturnType<typeof statusData>): void {
	const name =
		status.active?.alias || status.active?.generatedLabel || "unresolved";
	console.log(`openai active: ${name}`);
	console.log(`openai profiles: ${status.profileCount}`);
}

function printDiagnostics(diagnostics: Diagnostic[]): void {
	for (const diagnostic of diagnostics) {
		console.error(`ocma: ${diagnostic.code}: ${diagnostic.message}`);
	}
}
