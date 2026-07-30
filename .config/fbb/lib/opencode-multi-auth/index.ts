import { cancel, isCancel, text } from "@clack/prompts";
import { defineCommand, runMain } from "citty";
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

const formatArg = {
	type: "enum" as const,
	description: "Output format",
	options: ["text", "json"] as OutputFormat[],
	default: "text" as OutputFormat,
};

const main = defineCommand({
	meta: {
		name: "ocma",
		version: VERSION,
		description: "OpenCode multi-account management.",
	},
	subCommands: {
		list: defineCommand({
			meta: { name: "list", description: "List OpenAI profiles and aliases." },
			args: { format: formatArg },
			run: ({ args }) => runReadCommand("list", args.format),
		}),
		status: defineCommand({
			meta: { name: "status", description: "Show the active OpenAI profile." },
			args: { format: formatArg },
			run: ({ args }) => runReadCommand("status", args.format),
		}),
		switch: defineCommand({
			meta: {
				name: "switch",
				description: "Activate an OpenAI alias or generated label.",
			},
			args: { format: formatArg },
			run: ({ args }) => runSwitchCommand(args._, args.format),
		}),
		login: defineCommand({
			meta: {
				name: "login",
				description: "Log in and assign an OpenAI alias.",
			},
			args: { format: formatArg },
			run: ({ args }) => runLoginCommand(args._, args.format),
		}),
	},
});

await runMain(main, { rawArgs: normalizedArgs(process.argv.slice(2)) });

function normalizedArgs(args: string[]): string[] {
	if (args.length === 1 && args[0] === "help") {
		return ["--help"];
	}
	if (args.length === 1 && (args[0] === "-V" || args[0] === "--version")) {
		return ["--version"];
	}
	return args;
}

async function runReadCommand(
	command: "list" | "status",
	format: OutputFormat,
): Promise<void> {
	await emitCommand(format, command, async () => {
		const discovery = await discoverAccounts(defaultPaths());
		return successOutput(
			command,
			discovery,
			command === "list" ? listData(discovery) : statusData(discovery),
		);
	});
}

async function runSwitchCommand(
	positionals: string[],
	format: OutputFormat,
): Promise<void> {
	await emitCommand(format, "switch", async () => {
		if (positionals.length !== 1) {
			throw new Error("ocma switch: expected one alias or generated label");
		}
		const paths = defaultPaths();
		const lock = await acquireMutationLock(paths);
		try {
			await recoverPendingLogin(paths);
			const discovery = await switchAccount(positionals[0], paths);
			return successOutput("switch", discovery, statusData(discovery));
		} finally {
			await lock.release();
		}
	});
}

async function runLoginCommand(
	positionals: string[],
	format: OutputFormat,
): Promise<void> {
	await emitCommand(format, "login", async () => {
		if (positionals.length > 1) {
			throw new Error("ocma login: expected zero or one alias");
		}
		const requestedAlias = positionals[0] || (await promptForAlias(format));
		const paths = defaultPaths();
		const lock = await acquireMutationLock(paths);
		try {
			await recoverPendingLogin(paths);
			await beginLogin(requestedAlias, paths);
			try {
				await runOpenCodeLogin();
				const discovery = await completeLogin(paths);
				return successOutput("login", discovery, statusData(discovery));
			} catch (error) {
				await recoverPendingLogin(paths);
				throw error;
			}
		} finally {
			await lock.release();
		}
	});
}

async function emitCommand(
	format: OutputFormat,
	command: string,
	action: () => Promise<CommandOutput<unknown>>,
): Promise<void> {
	try {
		const output = await action();
		emitOutput(format, output);
		process.exitCode = exitCode(output.outcome);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const output = errorOutput(command, message);
		emitOutput(format, output);
		process.exitCode = exitCode(output.outcome);
	}
}

async function promptForAlias(format: OutputFormat): Promise<string> {
	if (format === "json" || process.stdin.isTTY !== true) {
		throw new Error(
			"ocma login: an alias is required when stdin is not interactive",
		);
	}
	const alias = await text({
		message: "Alias for the new OpenAI account",
		validate: (value) =>
			value?.trim() === "" ? "Alias cannot be empty" : undefined,
	});
	if (isCancel(alias)) {
		cancel("OpenCode login cancelled.");
		throw new Error("OpenCode login cancelled");
	}
	if (typeof alias !== "string") {
		throw new Error("OpenCode login did not return an alias");
	}
	return alias;
}

async function runOpenCodeLogin(): Promise<void> {
	const process = Bun.spawn(
		["opencode", "auth", "login", "--provider", "openai"],
		{
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	const exitCode = await process.exited;
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
		diagnostics: [{ code: "ocma-command-failed", message }],
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
