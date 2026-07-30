import { styleText } from "node:util";
import { isCancel, select, text } from "@clack/prompts";
import { defineCommand, runMain } from "citty";
import { colorProfileName } from "../profile-color.ts";
import { usageColor } from "../usage-color.ts";
import { discoverAccounts, toPublicDiscovery } from "./discovery.ts";
import {
	type DisplayAccountListProfile,
	renderAccountCards,
} from "./list-presentation.ts";
import { beginLogin, completeLogin, switchAccount } from "./mutations.ts";
import { assertMutableDiscovery } from "./profiles.ts";
import { discoverUsage, loginCommand } from "./providers/codex.ts";
import { mutateAccount } from "./queryclient/mutations.ts";
import { acquireMutationLock, readJsonObject } from "./storage.ts";
import { escapeTerminalText } from "./terminal-text.ts";
import { recoverPendingLogin } from "./transactions.ts";
import type {
	AccountDiscovery,
	AccountUsage,
	Diagnostic,
	PublicAccountDiscovery,
} from "./types.ts";
import { defaultPaths } from "./types.ts";

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

type ListData = Omit<PublicAccountDiscovery, "profiles"> & {
	profiles: DisplayAccountListProfile[];
};

type StatusData = {
	active: DisplayAccountListProfile | null;
	profileCount: number;
};

type TextOutputOptions = {
	colorEnabled: boolean;
	plain: boolean;
};

class UsageError extends Error {}

class PromptCancelled extends Error {}

const formatArg = {
	type: "enum" as const,
	description: "Output format",
	options: ["text", "json"] as OutputFormat[],
	default: "text" as OutputFormat,
};

const noColorArg = {
	type: "boolean" as const,
	description: "Disable ANSI color",
};

const plainArg = {
	type: "boolean" as const,
	description: "Use plain, narrow-safe text output",
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
			args: { format: formatArg, noColor: noColorArg, plain: plainArg },
			run: ({ args }) => runReadCommand("list", args.format, textOptions(args)),
		}),
		status: defineCommand({
			meta: { name: "status", description: "Show the active OpenAI profile." },
			args: { format: formatArg, noColor: noColorArg, plain: plainArg },
			run: ({ args }) =>
				runReadCommand("status", args.format, textOptions(args)),
		}),
		switch: defineCommand({
			meta: {
				name: "switch",
				description: "Activate an OpenAI alias or generated label.",
			},
			args: { format: formatArg, noColor: noColorArg, plain: plainArg },
			run: ({ args }) =>
				runSwitchCommand(args._, args.format, textOptions(args)),
		}),
		login: defineCommand({
			meta: {
				name: "login",
				description: "Log in and assign an OpenAI alias.",
			},
			args: { format: formatArg, noColor: noColorArg, plain: plainArg },
			run: ({ args }) =>
				runLoginCommand(args._, args.format, textOptions(args)),
		}),
	},
});

const rawArgs = normalizedArgs(process.argv.slice(2));
if (shouldDisableColor(rawArgs)) {
	process.env.NO_COLOR = "1";
	process.env.FORCE_COLOR = "0";
}
await runMain(main, { rawArgs });

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
	textOutput: TextOutputOptions,
): Promise<void> {
	await emitCommand(format, command, textOutput, async () => {
		const paths = defaultPaths();
		const discovery = await discoverAccounts(paths);
		const usage = await discoverUsageFor(discovery, paths, command === "list");
		const completeDiscovery = {
			...discovery,
			diagnostics: [...discovery.diagnostics, ...usage.diagnostics],
		};
		if (command === "list") {
			return successOutput(
				"list",
				completeDiscovery,
				listData(completeDiscovery, usage.usageByProfile),
			);
		}
		return successOutput(
			command,
			completeDiscovery,
			statusData(completeDiscovery, usage.usageByProfile),
		);
	});
}

async function runSwitchCommand(
	positionals: string[],
	format: OutputFormat,
	textOutput: TextOutputOptions,
): Promise<void> {
	await emitCommand(format, "switch", textOutput, async () => {
		if (positionals.length > 1) {
			throw new UsageError(
				"ocma switch: expected zero or one alias or generated label",
			);
		}
		const paths = defaultPaths();
		const currentDiscovery = await discoverAccounts(paths);
		const currentUsage = await discoverUsageFor(currentDiscovery, paths, true);
		const target =
			positionals[0] ||
			(await promptForSwitchTarget(
				currentDiscovery,
				currentUsage.usageByProfile,
				format,
				textOutput.colorEnabled,
			));
		const lock = await acquireMutationLock(paths);
		try {
			await mutateAccount(paths, "recover", () => recoverPendingLogin(paths));
			const discovery = await mutateAccount(paths, "switch", () =>
				switchAccount(target, paths),
			);
			const usage = await discoverUsageFor(discovery, paths, false);
			const completeDiscovery = {
				...discovery,
				diagnostics: [...discovery.diagnostics, ...usage.diagnostics],
			};
			return successOutput(
				"switch",
				completeDiscovery,
				statusData(completeDiscovery, usage.usageByProfile),
			);
		} finally {
			await lock.release();
		}
	});
}

async function discoverUsageFor(
	discovery: AccountDiscovery,
	paths: ReturnType<typeof defaultPaths>,
	includeInactiveProfiles: boolean,
) {
	return discoverUsage(
		{
			...discovery,
			profiles: includeInactiveProfiles
				? discovery.profiles
				: discovery.profiles.filter((profile) => profile.active),
		},
		await readJsonObject(paths.auth),
		paths,
	);
}

async function runLoginCommand(
	positionals: string[],
	format: OutputFormat,
	textOutput: TextOutputOptions,
): Promise<void> {
	await emitCommand(format, "login", textOutput, async () => {
		if (format === "json") {
			throw new UsageError(
				"ocma login: JSON output is unavailable because OpenCode login is interactive",
			);
		}
		if (positionals.length > 1) {
			throw new UsageError("ocma login: expected zero or one alias");
		}
		const requestedAlias = positionals[0] || (await promptForAlias(format));
		const paths = defaultPaths();
		const lock = await acquireMutationLock(paths);
		try {
			await mutateAccount(paths, "recover", () => recoverPendingLogin(paths));
			await mutateAccount(paths, "login-prepare", () =>
				beginLogin(requestedAlias, paths),
			);
			try {
				await runOpenCodeLogin();
				const discovery = await mutateAccount(paths, "login-complete", () =>
					completeLogin(paths),
				);
				return successOutput("login", discovery, statusData(discovery));
			} catch (error) {
				await mutateAccount(paths, "recover", () => recoverPendingLogin(paths));
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
	textOutput: TextOutputOptions,
	action: () => Promise<CommandOutput<unknown>>,
): Promise<void> {
	try {
		const output = await action();
		emitOutput(format, output, textOutput);
		process.exitCode = exitCode(output.outcome);
	} catch (error) {
		if (error instanceof PromptCancelled) {
			console.error("Info     Cancelled.");
			process.exitCode = 0;
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		const output = errorOutput(command, message);
		emitOutput(format, output, textOutput);
		process.exitCode =
			error instanceof UsageError ? 2 : exitCode(output.outcome);
	}
}

async function promptForAlias(format: OutputFormat): Promise<string> {
	if (format === "json" || process.stdin.isTTY !== true) {
		throw new UsageError(
			"ocma login: an alias is required when stdin is not interactive",
		);
	}
	const alias = await text({
		message: "Alias for the new OpenAI account",
		validate: (value) =>
			value?.trim() === "" ? "Alias cannot be empty" : undefined,
	});
	if (isCancel(alias)) {
		throw new PromptCancelled();
	}
	if (typeof alias !== "string") {
		throw new Error("OpenCode login did not return an alias");
	}
	return alias;
}

async function promptForSwitchTarget(
	discovery: AccountDiscovery,
	usageByProfile: Map<string, AccountUsage>,
	format: OutputFormat,
	colorEnabled: boolean,
): Promise<string> {
	if (format === "json" || process.stdin.isTTY !== true) {
		throw new UsageError(
			"ocma switch: an alias or generated label is required when stdin is not interactive",
		);
	}
	assertMutableDiscovery(discovery);
	const target = await select({
		message: "Select account",
		options: discovery.profiles.map((profile) => ({
			value: profile.alias || profile.generatedLabel || profile.key,
			label: colorProfileName(
				escapeTerminalText(
					profile.alias || profile.generatedLabel || profile.key,
				),
				profile.displayColor,
				colorEnabled,
			),
			hint: switchUsageHint(
				profile.active,
				usageByProfile.get(profile.key),
				colorEnabled,
			),
		})),
	});
	if (isCancel(target)) {
		throw new PromptCancelled();
	}
	if (typeof target !== "string") {
		throw new Error("ocma switch did not return a target");
	}
	return target;
}

function switchUsageHint(
	active: boolean,
	usage: AccountUsage | undefined,
	colorEnabled: boolean,
): string {
	const state = active ? "active" : "inactive";
	if (usage?.primary.remainingPercent === null || usage === undefined) {
		return `${state}  usage unavailable`;
	}
	const remaining = `${usage.primary.remainingPercent}% remaining`;
	return `${state}  ${colorEnabled ? styleText(["bold", usageColor(usage.primary.remainingPercent)], remaining) : remaining}`;
}

async function runOpenCodeLogin(): Promise<void> {
	const process = Bun.spawn(loginCommand, {
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
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

function listData(
	discovery: AccountDiscovery,
	usageByProfile: Map<string, AccountUsage>,
): ListData {
	const publicDiscovery = toPublicDiscovery(discovery);
	const colors = new Map(
		discovery.profiles.map((profile) => [profile.key, profile.displayColor]),
	);
	return {
		...publicDiscovery,
		profiles: publicDiscovery.profiles.map((profile) => ({
			...profile,
			usage: usageByProfile.get(profile.key) || null,
			displayColor: colors.get(profile.key) || null,
		})),
	};
}

function statusData(
	discovery: AccountDiscovery,
	usageByProfile: Map<string, AccountUsage> = new Map(),
): StatusData {
	const publicDiscovery = toPublicDiscovery(discovery);
	const active = publicDiscovery.profiles.find((profile) => profile.active);
	return {
		active: active
			? {
					...active,
					usage: usageByProfile.get(active.key) || null,
					displayColor:
						discovery.profiles.find((profile) => profile.key === active.key)
							?.displayColor || null,
				}
			: null,
		profileCount: publicDiscovery.profiles.length,
	};
}

function emitOutput(
	format: OutputFormat,
	output: CommandOutput<unknown>,
	textOutput: TextOutputOptions,
): void {
	if (format === "json") {
		console.log(
			JSON.stringify(
				output,
				(key, value) => (key === "displayColor" ? undefined : value),
				2,
			),
		);
		return;
	}

	if (output.outcome === "error") {
		printDiagnostics(output.diagnostics);
		return;
	}

	if (output.command === "list") {
		printAccounts(output.data as ListData, textOutput);
	} else {
		printStatus(output.data as StatusData, textOutput);
	}
	printDiagnostics(output.diagnostics, output.outcome);
}

function exitCode(outcome: Outcome): number {
	return outcome === "success" ? 0 : 1;
}

function printAccounts(
	discovery: ListData,
	textOutput: TextOutputOptions,
): void {
	console.log(renderAccountCards(discovery.profiles, textOutput));
}

function printStatus(status: StatusData, textOutput: TextOutputOptions): void {
	console.log(
		renderAccountCards(status.active ? [status.active] : [], {
			...textOutput,
			heading: `OpenAI account (${status.profileCount} profiles)`,
			emptyMessage: "No active account found.",
			nextAction: "  Run `ocma login <alias>` to add an account.",
		}),
	);
}

function printDiagnostics(
	diagnostics: Diagnostic[],
	outcome: Outcome = "error",
): void {
	for (const diagnostic of diagnostics) {
		const code = escapeTerminalText(diagnostic.code);
		const message = escapeTerminalText(diagnostic.message);
		if (outcome === "warning") {
			console.error(`Warning  ${code}: ${message}`);
		} else {
			console.error(`ocma: ${code}: ${message}`);
		}
	}
}

function textOptions(args: {
	noColor?: boolean;
	plain?: boolean;
}): TextOutputOptions {
	const plain = args.plain === true;
	return {
		plain,
		colorEnabled: plain === false && shouldDisableColor() === false,
	};
}

function shouldDisableColor(args: string[] = process.argv.slice(2)): boolean {
	return (
		args.includes("--no-color") ||
		args.includes("--plain") ||
		(process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") ||
		process.env.TERM === "dumb" ||
		process.stdout.isTTY !== true
	);
}
