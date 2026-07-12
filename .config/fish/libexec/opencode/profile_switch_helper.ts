#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import { writeJsonAtomic } from "../shared/fs.js";

type AppResult<T> = Result<T, string>;

type AgentOptions = {
    model?: string | null;
    [key: string]: unknown;
};
type AgentMap = Record<string, AgentOptions | null>;
type ProfileSpec = {
    description: string;
    model: string | null;
    small_model: string | null;
    agents: AgentMap;
};

type ConfigShape = {
    model?: string;
    small_model?: string;
    agent?: Record<string, { model?: string; [key: string]: unknown } | undefined>;
    [key: string]: unknown;
};

const profileManagedAgentKeys = [
    "model",
    "reasoningEffort",
    "textVerbosity",
    "reasoningSummary",
    "include",
    "thinking",
];

const AgentOptionsSchema = z
    .object({
        model: z.string().nullable().optional(),
        reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
        textVerbosity: z.enum(["low", "medium", "high"]).optional(),
        reasoningSummary: z.enum(["auto", "detailed", "none"]).optional(),
    })
    .catchall(z.unknown());

const ProfileAgentSchema = z.union([z.string(), z.null(), AgentOptionsSchema]);

const ProfilesSchema = z.object({
    profiles: z.record(
        z.string(),
        z.object({
            description: z.string().optional(),
            model: z.string().nullable().optional(),
            small_model: z.string().nullable().optional(),
            agents: z.record(z.string(), ProfileAgentSchema).optional(),
        }),
    ),
});

const ConfigSchema = z
    .object({
        model: z.string().optional(),
        small_model: z.string().optional(),
        agent: z.record(z.string(), z.object({ model: z.string().optional() }).catchall(z.unknown())).optional(),
    })
    .passthrough();

type StringState = {
    inString: boolean;
    escaped: boolean;
};

function advanceString(text: string, index: number, out: string[], state: StringState): number {
    const character = text[index];
    out.push(character);
    if (state.escaped) {
        state.escaped = false;
    } else if (character === "\\") {
        state.escaped = true;
    } else if (character === '"') {
        state.inString = false;
    }
    return index + 1;
}

function transformOutsideStrings(
    text: string,
    transform: (text: string, index: number, out: string[]) => number,
): string {
    const out: string[] = [];
    let i = 0;
    const length = text.length;
    const state: StringState = { inString: false, escaped: false };

    while (i < length) {
        const ch = text[i];
        if (state.inString) {
            i = advanceString(text, i, out, state);
            continue;
        }

        if (ch === '"') {
            state.inString = true;
            out.push(ch);
            i += 1;
            continue;
        }

        i = transform(text, i, out);
    }

    return out.join("");
}

function lineCommentEnd(text: string, index: number): number {
    while (index < text.length && text[index] !== "\n") {
        index += 1;
    }
    return index;
}

function blockCommentEnd(text: string, index: number): number {
    while (index + 1 < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        index += 1;
    }
    return index + 2;
}

function commentEnd(text: string, index: number): number | null {
    if (text[index] !== "/") {
        return null;
    }

    const marker = text[index + 1];
    if (marker === "/") {
        return lineCommentEnd(text, index + 2);
    }
    if (marker === "*") {
        return blockCommentEnd(text, index + 2);
    }
    return null;
}

function copyWithoutComments(text: string, index: number, out: string[]): number {
    const end = commentEnd(text, index);
    if (end !== null) {
        return end;
    }

    out.push(text[index]);
    return index + 1;
}

function stripComments(text: string): string {
    return transformOutsideStrings(text, copyWithoutComments);
}

function nextNonWhitespaceIndex(text: string, index: number): number {
    while (index < text.length && " \t\r\n".includes(text[index])) {
        index += 1;
    }
    return index;
}

function isTrailingComma(text: string, index: number): boolean {
    if (text[index] !== ",") {
        return false;
    }

    const next = nextNonWhitespaceIndex(text, index + 1);
    return next < text.length && "}]".includes(text[next]);
}

function copyWithoutTrailingCommas(text: string, index: number, out: string[]): number {
    if (!isTrailingComma(text, index)) {
        out.push(text[index]);
    }
    return index + 1;
}

function stripTrailingCommas(text: string): string {
    return transformOutsideStrings(text, copyWithoutTrailingCommas);
}

function readJsonc<T>(filePath: string): AppResult<T> {
    try {
        const text = readFileSync(filePath, "utf8");
        return ok(JSON.parse(stripTrailingCommas(stripComments(text))) as T);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

function normalizeProfileAgent(value: z.infer<typeof ProfileAgentSchema>): AgentOptions | null {
    if (value === null) {
        return null;
    }
    if (typeof value === "string") {
        return { model: value };
    }
    return value;
}

function profileSpecFromParsed(value: z.infer<typeof ProfilesSchema>["profiles"][string]): ProfileSpec {
    return {
        description: value.description || "",
        model: value.model ?? null,
        small_model: value.small_model ?? null,
        agents: Object.fromEntries(
            Object.entries(value.agents || {}).map(([agentName, agentValue]) => [
                agentName,
                normalizeProfileAgent(agentValue),
            ]),
        ),
    };
}

function managedAgentSnapshot(agent: { [key: string]: unknown } | undefined): AgentOptions | null {
    if (!agent) {
        return null;
    }

    const entries = profileManagedAgentKeys
        .filter((key) => agent[key] !== undefined)
        .map((key) => [key, agent[key]] as const);
    if (entries.length === 0) {
        return null;
    }

    return Object.fromEntries(entries);
}

function clearManagedAgentOptions(agent: { model?: string; [key: string]: unknown }): {
    model?: string;
    [key: string]: unknown;
} {
    const nextAgent = { ...agent };
    for (const key of profileManagedAgentKeys) {
        delete nextAgent[key];
    }
    return nextAgent;
}

function applyAgentOptions(
    agent: { model?: string; [key: string]: unknown },
    options: AgentOptions | null | undefined,
): { model?: string; [key: string]: unknown } {
    const nextAgent = clearManagedAgentOptions(agent);
    if (!options) {
        return nextAgent;
    }

    for (const [key, value] of Object.entries(options)) {
        if (value !== undefined && value !== null) {
            nextAgent[key] = value;
        }
    }

    return nextAgent;
}

function agentOptionsEqual(left: AgentOptions | null | undefined, right: AgentOptions | null | undefined): boolean {
    const leftEntries = Object.entries(left || {}).filter(([, value]) => value !== undefined);
    const rightEntries = Object.entries(right || {}).filter(([, value]) => value !== undefined);
    if (leftEntries.length !== rightEntries.length) {
        return false;
    }

    for (const [key, leftValue] of leftEntries) {
        if (JSON.stringify(leftValue) !== JSON.stringify(right?.[key])) {
            return false;
        }
    }

    return true;
}

function currentSnapshot(config: ConfigShape): { model: string | null; small_model: string | null; agents: AgentMap } {
    const agentEntries = Object.entries(config.agent || {}).map(
        ([name, spec]) => [name, managedAgentSnapshot(spec)] as const,
    );
    return {
        model: config.model ?? null,
        small_model: config.small_model ?? null,
        agents: Object.fromEntries(agentEntries),
    };
}

function profileMatches(snapshot: ReturnType<typeof currentSnapshot>, profile: ProfileSpec): boolean {
    if (snapshot.model !== profile.model || snapshot.small_model !== profile.small_model) {
        return false;
    }

    const agentNames = new Set([...Object.keys(snapshot.agents), ...Object.keys(profile.agents)]);
    for (const agentName of agentNames) {
        if (!agentOptionsEqual(snapshot.agents[agentName], profile.agents[agentName])) {
            return false;
        }
    }

    return true;
}

type LoadedProfilesAndConfig = {
    profiles: z.infer<typeof ProfilesSchema>["profiles"];
    config: ConfigShape;
};

function readProfiles(profilesPath: string): AppResult<LoadedProfilesAndConfig["profiles"]> {
    const result = readJsonc<unknown>(profilesPath);
    if (result.isErr()) {
        return err(`failed to parse profiles: ${result.error}`);
    }

    const parsed = ProfilesSchema.safeParse(result.value);
    if (parsed.success) {
        return ok(parsed.data.profiles);
    }

    return err("profiles file missing valid profiles object");
}

function readConfig(configPath: string): AppResult<ConfigShape> {
    const result = readJsonc<unknown>(configPath);
    if (result.isErr()) {
        return err(`failed to parse config: ${result.error}`);
    }

    const parsed = ConfigSchema.safeParse(result.value);
    if (parsed.success) {
        return ok(result.value as ConfigShape);
    }

    return err("config file invalid");
}

function loadProfilesAndConfig(profilesPath: string, configPath: string): AppResult<LoadedProfilesAndConfig> {
    const profilesResult = readProfiles(profilesPath);
    if (profilesResult.isErr()) {
        return err(profilesResult.error);
    }
    const configResult = readConfig(configPath);
    if (configResult.isErr()) {
        return err(configResult.error);
    }

    return ok({ profiles: profilesResult.value, config: configResult.value });
}

function listProfiles(profilesPath: string, configPath: string): AppResult<string> {
    const loadedResult = loadProfilesAndConfig(profilesPath, configPath);
    if (loadedResult.isErr()) {
        return err(loadedResult.error);
    }

    const { profiles, config } = loadedResult.value;
    const snapshot = currentSnapshot(config);
    const items = Object.entries(profiles).map(([name, value]) => {
        const profile = profileSpecFromParsed(value);
        return {
            name,
            description: profile.description,
            active: profileMatches(snapshot, profile),
        };
    });

    return ok(items.map((item) => [item.name, item.description, String(item.active)].join("\t")).join("\n"));
}

function applyProfileModelSettings(config: ConfigShape, profile: ProfileSpec): void {
    if (profile.model !== null) {
        config.model = profile.model;
    }
    if (profile.small_model !== null) {
        config.small_model = profile.small_model;
    }
}

function updatedAgents(existingAgents: NonNullable<ConfigShape["agent"]>, profileAgents: AgentMap) {
    const updatedAgents = Object.fromEntries(
        Object.entries(existingAgents).map(([agentName, agentValue]) => [
            agentName,
            applyAgentOptions({ ...(agentValue || {}) }, profileAgents[agentName]),
        ]),
    ) as Record<string, { model?: string; [key: string]: unknown }>;

    for (const [agentName, agentOptions] of Object.entries(profileAgents)) {
        if (agentName in updatedAgents || agentOptions === null) {
            continue;
        }
        updatedAgents[agentName] = applyAgentOptions({}, agentOptions);
    }

    return updatedAgents;
}

function updatedConfig(config: ConfigShape, profile: ProfileSpec): ConfigShape {
    const nextConfig: ConfigShape = structuredClone(config);
    applyProfileModelSettings(nextConfig, profile);
    nextConfig.agent = updatedAgents(nextConfig.agent || {}, profile.agents);
    return nextConfig;
}

function applyProfile(profilesPath: string, configPath: string, profileName: string): AppResult<string> {
    const loadedResult = loadProfilesAndConfig(profilesPath, configPath);
    if (loadedResult.isErr()) {
        return err(loadedResult.error);
    }

    const target = loadedResult.value.profiles[profileName];
    if (!target) {
        return err(`missing profile: ${profileName}`);
    }

    const profile = profileSpecFromParsed(target);
    const nextConfig = updatedConfig(loadedResult.value.config, profile);

    const writeResult = writeJsonAtomic(configPath, nextConfig);
    if (writeResult.isErr()) {
        return err(writeResult.error);
    }

    return ok(profile.description);
}

function usage(): void {
    console.log("Usage:");
    console.log("  opencode/profile_switch_helper.ts list <profiles.jsonc> <opencode.json/jsonc>");
    console.log("  opencode/profile_switch_helper.ts apply <profiles.jsonc> <opencode.json/jsonc> <profile>");
}

const commandHandlers: Record<string, (args: string[]) => AppResult<string>> = {
    list: (args) => (args.length === 2 ? listProfiles(args[0], args[1]) : err("list requires 2 args")),
    apply: (args) => (args.length === 3 ? applyProfile(args[0], args[1], args[2]) : err("apply requires 3 args")),
};

function runCommand(command: string, args: string[]): AppResult<string> {
    const handler = commandHandlers[command];
    if (handler) {
        return handler(args);
    }
    return err(`unknown command: ${command}`);
}

function commandOrUsageExit(command: string | undefined): string | number {
    if (!command) {
        usage();
        return 1;
    }
    if (command === "-h" || command === "--help") {
        usage();
        return 0;
    }
    return command;
}

function emitResult(result: AppResult<string>): number {
    if (result.isErr()) {
        console.error(`opencode_profile_switch_helper: ${result.error}`);
        return 1;
    }

    console.log(result.value);
    return 0;
}

function main(): number {
    const [, , command, ...args] = process.argv;
    const commandOrExitCode = commandOrUsageExit(command);
    return typeof commandOrExitCode === "number" ? commandOrExitCode : emitResult(runCommand(commandOrExitCode, args));
}

process.exit(main());
