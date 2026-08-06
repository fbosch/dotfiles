import { isCancel, select, text } from "@clack/prompts";
import { defineCommand, runMain } from "citty";
import { colorProfileName } from "../profile-color.ts";
import { colorUsage } from "../usage-color.ts";
import { discoverAccounts, toPublicDiscovery } from "./discovery.ts";
import {
	type DisplayAccountListProfile,
	renderAccountCards,
} from "./list-presentation.ts";
import { beginLogin, completeLogin, switchAccount } from "./mutations.ts";
import { assertMutableDiscovery } from "./profiles.ts";
import {
	aliasesFor,
	discoverResetCredits,
	discoverUsage,
	loginCommand,
	refreshExpiredProfileCredentials,
} from "./providers/codex.ts";
import { mutateAccount } from "./queryclient/mutations.ts";
import {
	renderResetConsume,
	renderResetPreview,
	renderResetStatus,
} from "./reset-presentation.ts";
import {
	previewResetCredit,
	redeemResetCredit,
	resetProfilesFromLegacyAuth,
	resetProfilesFromOpenCodeAuth,
	resetStatus,
	type ResetConsumeData,
	type ResetPreviewData,
	type ResetProfile,
	type ResetStatusData,
} from "./reset.ts";
import { acquireMutationLock, readJsonObject } from "./storage.ts";
import { escapeTerminalText } from "./terminal-text.ts";
import { recoverPendingLogin } from "./transactions.ts";
import type {
	AccountDiscovery,
	AccountResetCredits,
	AccountUsage,
	Diagnostic,
	PublicAccountDiscovery,
} from "./types.ts";
import { defaultPaths, type AccountPaths } from "./types.ts";

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
		reset: defineCommand({
			meta: { name: "reset", description: "Manage ChatGPT reset credits." },
			subCommands: {
				status: defineCommand({
					meta: {
						name: "status",
						description: "Show reset credits and usage.",
					},
					args: {
						format: formatArg,
						noColor: noColorArg,
						plain: plainArg,
						refresh: { type: "boolean" },
						auth: { type: "string" },
					},
					run: ({ args, rawArgs }) =>
						runResetStatus(
							args.format,
							args.refresh === true,
							args.auth,
							rawArgs,
							textOptions(args),
						),
				}),
				preview: defineCommand({
					meta: {
						name: "preview",
						description: "Preview an available reset credit.",
					},
					args: {
						format: formatArg,
						noColor: noColorArg,
						plain: plainArg,
						"credit-id": { type: "string" },
						auth: { type: "string" },
					},
					run: ({ args, rawArgs }) =>
						runResetPreview(
							args.format,
							args["credit-id"],
							args.auth,
							rawArgs,
							textOptions(args),
						),
				}),
				consume: defineCommand({
					meta: {
						name: "consume",
						description: "Redeem an available reset credit.",
					},
					args: {
						format: formatArg,
						noColor: noColorArg,
						plain: plainArg,
						"credit-id": { type: "string" },
						auth: { type: "string" },
					},
					run: ({ args, rawArgs }) =>
						runResetConsume(
							args.format,
							args["credit-id"],
							args.auth,
							rawArgs,
							textOptions(args),
						),
				}),
			},
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
		const refreshed = await refreshExpiredProfileCredentials(discovery, paths);
		const [usage, resetCredits] = await Promise.all([
			discoverUsageFor(discovery, refreshed.auth, paths, command === "list"),
			discoverResetCreditsFor(
				discovery,
				refreshed.auth,
				paths,
				command === "list",
			),
		]);
		const completeDiscovery = {
			...discovery,
			diagnostics: [
				...discovery.diagnostics,
				...refreshed.diagnostics,
				...usage.diagnostics,
				...resetCredits.diagnostics,
			],
		};
		if (command === "list") {
			return successOutput(
				"list",
				completeDiscovery,
				listData(
					completeDiscovery,
					usage.usageByProfile,
					resetCredits.resetCreditsByProfile,
				),
			);
		}
		return successOutput(
			command,
			completeDiscovery,
			statusData(
				completeDiscovery,
				usage.usageByProfile,
				resetCredits.resetCreditsByProfile,
			),
		);
	});
}

async function runResetStatus(
	format: OutputFormat,
	refresh: boolean,
	authPath: string | undefined,
	rawArgs: string[],
	textOutput: TextOutputOptions,
): Promise<void> {
	await emitCommand(format, "reset.status", textOutput, async () => {
		assertResetArguments("status", rawArgs, [
			"format",
			"no-color",
			"plain",
			"refresh",
			"auth",
		]);
		const paths = defaultPaths();
		const result = await withResetLock(paths, async () =>
			resetStatus(await resetProfiles(authPath, paths), paths, refresh),
		);
		return resetOutput("reset.status", result.value, result.releaseError);
	});
}

async function runResetPreview(
	format: OutputFormat,
	creditId: string | undefined,
	authPath: string | undefined,
	rawArgs: string[],
	textOutput: TextOutputOptions,
): Promise<void> {
	await emitCommand(format, "reset.preview", textOutput, async () => {
		assertResetArguments("preview", rawArgs, [
			"format",
			"no-color",
			"plain",
			"credit-id",
			"auth",
		]);
		const profile = await activeResetProfile(authPath, defaultPaths());
		return resetSuccess("reset.preview", {
			profileLabel: profile.profileLabel,
			displayColor: profile.displayColor ?? null,
			credit: await previewResetCredit(profile, creditId),
		});
	});
}

async function runResetConsume(
	format: OutputFormat,
	creditId: string | undefined,
	authPath: string | undefined,
	rawArgs: string[],
	textOutput: TextOutputOptions,
): Promise<void> {
	await emitCommand(format, "reset.consume", textOutput, async () => {
		assertResetArguments("consume", rawArgs, [
			"format",
			"no-color",
			"plain",
			"credit-id",
			"auth",
		]);
		if (creditId === undefined || creditId === "") {
			throw new UsageError("ocma reset consume: --credit-id is required");
		}
		const paths = defaultPaths();
		const result = await withResetLock(paths, async () => {
			const profile = await activeResetProfile(authPath, paths);
			return {
				profileLabel: profile.profileLabel,
				displayColor: profile.displayColor ?? null,
				redemption: await redeemResetCredit(profile, creditId, paths),
			};
		});
		const output = resetOutput(
			"reset.consume",
			{
				profileLabel: result.value.profileLabel,
				displayColor: result.value.displayColor,
				...result.value.redemption.data,
			},
			result.releaseError,
		);
		if (result.value.redemption.cacheInvalidationError) {
			output.diagnostics.push({
				code: "reset-cache-invalidation-failed",
				message: result.value.redemption.cacheInvalidationError,
			});
		}
		return output;
	});
}

async function resetProfiles(
	authPath: string | undefined,
	paths: AccountPaths,
): Promise<ResetProfile[]> {
	const aliases = aliasesFor(await readJsonObject(paths.aliases), paths.aliases);
	if (authPath) {
		return resetProfilesFromLegacyAuth(authPath, aliases);
	}
	return resetProfilesFromOpenCodeAuth(await readJsonObject(paths.auth), aliases);
}

async function activeResetProfile(
	authPath: string | undefined,
	paths: AccountPaths,
): Promise<ResetProfile> {
	const profiles = await resetProfiles(authPath, paths);
	const profile = profiles.find((candidate) => candidate.active);
	if (profile === undefined) throw new Error("active OpenAI profile is missing");
	return profile;
}

async function withResetLock<T>(
	paths: AccountPaths,
	action: () => Promise<T>,
): Promise<{ value: T; releaseError: string | null }> {
	const lock = await acquireMutationLock(paths);
	let value: T;
	try {
		value = await action();
	} catch (error) {
		await lock.release().catch(() => undefined);
		throw error;
	}
	try {
		await lock.release();
		return { value, releaseError: null };
	} catch {
		return {
			value,
			releaseError: "operation completed, but mutation lock cleanup failed",
		};
	}
}

function assertResetArguments(
	command: string,
	rawArgs: string[],
	allowedOptions: string[],
): void {
	for (let index = 0; index < rawArgs.length; index += 1) {
		index += resetArgumentValueOffset(
			command,
			rawArgs[index],
			rawArgs[index + 1],
			allowedOptions,
		);
	}
}

function resetArgumentValueOffset(
	command: string,
	argument: string,
	nextArgument: string | undefined,
	allowedOptions: string[],
): number {
	if (argument.startsWith("--") === false) {
		throw new UsageError(`ocma reset ${command}: unexpected argument: ${argument}`);
	}
	const [option, inlineValue] = argument.slice(2).split("=", 2);
	if (allowedOptions.includes(option) === false) {
		throw new UsageError(`ocma reset ${command}: unknown option: --${option}`);
	}
	if (["format", "credit-id", "auth"].includes(option)) {
		return resetValueOffset(command, option, inlineValue, nextArgument);
	}
	if (inlineValue !== undefined) {
		throw new UsageError(`ocma reset ${command}: --${option} does not take a value`);
	}
	return 0;
}

function resetValueOffset(
	command: string,
	option: string,
	inlineValue: string | undefined,
	nextArgument: string | undefined,
): number {
	if (inlineValue === "") {
		throw new UsageError(`ocma reset ${command}: --${option} requires a value`);
	}
	if (inlineValue !== undefined) {
		return 0;
	}
	if (nextArgument === undefined || nextArgument.startsWith("-")) {
		throw new UsageError(`ocma reset ${command}: --${option} requires a value`);
	}
	return 1;
}

function resetSuccess<T>(command: string, data: T): CommandOutput<T> {
	return { schema: OUTPUT_SCHEMA, command, outcome: "success", data, diagnostics: [] };
}

function resetOutput<T>(
	command: string,
	data: T,
	releaseError: string | null,
): CommandOutput<T> {
	const output = resetSuccess(command, data);
	if (releaseError) {
		output.diagnostics.push({
			code: "mutation-lock-cleanup-failed",
			message: releaseError,
		});
	}
	return output;
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
		const refreshed = await refreshExpiredProfileCredentials(
			currentDiscovery,
			paths,
		);
		const currentUsage = await discoverUsageFor(
			currentDiscovery,
			refreshed.auth,
			paths,
			true,
		);
		const target = positionals[0];
		const selectedTarget =
			target ||
			(await promptForSwitchTarget(
				currentDiscovery,
				currentUsage.usageByProfile,
				format,
				textOutput.colorEnabled,
			));
		if (!target) {
			console.log(textOutput.colorEnabled ? "\x1b[90m│\x1b[39m" : "│");
		}
		let discovery: AccountDiscovery;
		const lock = await acquireMutationLock(paths);
		try {
			await mutateAccount(paths, "recover", () => recoverPendingLogin(paths));
			discovery = await mutateAccount(paths, "switch", () =>
				switchAccount(selectedTarget, paths),
			);
		} finally {
			await lock.release();
		}
		const refreshedAfterSwitch = await refreshExpiredProfileCredentials(
			discovery,
			paths,
		);
		const [usage, resetCredits] = await Promise.all([
			discoverUsageFor(
				discovery,
				refreshedAfterSwitch.auth,
				paths,
				false,
			),
			discoverResetCreditsFor(
				discovery,
				refreshedAfterSwitch.auth,
				paths,
				false,
			),
		]);
		const completeDiscovery = {
			...discovery,
			diagnostics: [
				...discovery.diagnostics,
				...refreshedAfterSwitch.diagnostics,
				...usage.diagnostics,
				...resetCredits.diagnostics,
			],
		};
		return successOutput(
			"switch",
			completeDiscovery,
			statusData(
				completeDiscovery,
				usage.usageByProfile,
				resetCredits.resetCreditsByProfile,
			),
		);
	});
}

async function discoverUsageFor(
	discovery: AccountDiscovery,
	auth: Awaited<ReturnType<typeof readJsonObject>>,
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
		auth,
		paths,
	);
}

async function discoverResetCreditsFor(
	discovery: AccountDiscovery,
	auth: Awaited<ReturnType<typeof readJsonObject>>,
	paths: ReturnType<typeof defaultPaths>,
	includeInactiveProfiles: boolean,
) {
	return discoverResetCredits(
		{
			...discovery,
			profiles: includeInactiveProfiles
				? discovery.profiles
				: discovery.profiles.filter((profile) => profile.active),
		},
		auth,
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
	return `${state}  ${colorUsage(remaining, usage.primary.remainingPercent, colorEnabled, true)}`;
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
	resetCreditsByProfile: Map<string, AccountResetCredits>,
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
			resetCredits: resetCreditsByProfile.get(profile.key) || null,
			displayColor: colors.get(profile.key) || null,
		})),
	};
}

function statusData(
	discovery: AccountDiscovery,
	usageByProfile: Map<string, AccountUsage> = new Map(),
	resetCreditsByProfile: Map<string, AccountResetCredits> = new Map(),
): StatusData {
	const publicDiscovery = toPublicDiscovery(discovery);
	const active = publicDiscovery.profiles.find((profile) => profile.active);
	return {
		active: active
			? {
					...active,
					usage: usageByProfile.get(active.key) || null,
					resetCredits: resetCreditsByProfile.get(active.key) || null,
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
	} else if (output.command === "status") {
		printStatus(output.data as StatusData, textOutput);
	} else if (output.command.startsWith("reset.")) {
		printResetOutput(output, textOutput);
	}
	printDiagnostics(output.diagnostics, output.outcome);
}

function printResetOutput(
	output: CommandOutput<unknown>,
	textOutput: TextOutputOptions,
): void {
	if (output.command === "reset.status") {
		console.log(renderResetStatus(output.data as ResetStatusData, textOutput));
		return;
	}
	if (output.command === "reset.preview") {
		console.log(renderResetPreview(output.data as ResetPreviewData, textOutput));
		return;
	}
	console.log(renderResetConsume(output.data as ResetConsumeData, textOutput));
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
