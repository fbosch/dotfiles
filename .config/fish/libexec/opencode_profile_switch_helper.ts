#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

type AppResult<T> = Result<T, string>;

type AgentMap = Record<string, string | null>;
type ProfileSpec = {
    description: string;
    model: string | null;
    small_model: string | null;
    agents: AgentMap;
};

type ConfigShape = {
    model?: string;
    small_model?: string;
    agent?: Record<string, { model?: string } | undefined>;
    [key: string]: unknown;
};

const ProfilesSchema = z.object({
    profiles: z.record(
        z.string(),
        z.object({
            description: z.string().optional(),
            model: z.string().nullable().optional(),
            small_model: z.string().nullable().optional(),
            agents: z.record(z.string(), z.string()).optional(),
        }),
    ),
});

const ConfigSchema = z
    .object({
        model: z.string().optional(),
        small_model: z.string().optional(),
        agent: z.record(z.string(), z.object({ model: z.string().optional() }).passthrough()).optional(),
    })
    .passthrough();

function stripComments(text: string): string {
    const out: string[] = [];
    let i = 0;
    const length = text.length;
    let inString = false;
    let escaped = false;

    while (i < length) {
        const ch = text[i];
        const nxt = i + 1 < length ? text[i + 1] : "";

        if (inString) {
            out.push(ch);
            if (escaped) {
                escaped = false;
            } else if (ch === "\\") {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            i += 1;
            continue;
        }

        if (ch === '"') {
            inString = true;
            out.push(ch);
            i += 1;
            continue;
        }

        if (ch === "/" && nxt === "/") {
            i += 2;
            while (i < length && text[i] !== "\n") {
                i += 1;
            }
            continue;
        }

        if (ch === "/" && nxt === "*") {
            i += 2;
            while (i + 1 < length && !(text[i] === "*" && text[i + 1] === "/")) {
                i += 1;
            }
            i += 2;
            continue;
        }

        out.push(ch);
        i += 1;
    }

    return out.join("");
}

function stripTrailingCommas(text: string): string {
    const out: string[] = [];
    let i = 0;
    const length = text.length;
    let inString = false;
    let escaped = false;

    while (i < length) {
        const ch = text[i];

        if (inString) {
            out.push(ch);
            if (escaped) {
                escaped = false;
            } else if (ch === "\\") {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            i += 1;
            continue;
        }

        if (ch === '"') {
            inString = true;
            out.push(ch);
            i += 1;
            continue;
        }

        if (ch === ",") {
            let j = i + 1;
            while (j < length && " \t\r\n".includes(text[j])) {
                j += 1;
            }
            if (j < length && "}]".includes(text[j])) {
                i += 1;
                continue;
            }
        }

        out.push(ch);
        i += 1;
    }

    return out.join("");
}

function readJsonc<T>(filePath: string): AppResult<T> {
    try {
        const raw = readFileSync(filePath, "utf8");
        return ok(JSON.parse(stripTrailingCommas(stripComments(raw))) as T);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

function profileSpecFromParsed(value: z.infer<typeof ProfilesSchema>["profiles"][string]): ProfileSpec {
    return {
        description: value.description || "",
        model: value.model ?? null,
        small_model: value.small_model ?? null,
        agents: value.agents || {},
    };
}

function currentSnapshot(config: ConfigShape): { model: string | null; small_model: string | null; agents: AgentMap } {
    const agentEntries = Object.entries(config.agent || {}).map(([name, spec]) => [name, spec?.model ?? null] as const);
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

    for (const [agentName, currentModel] of Object.entries(snapshot.agents)) {
        const profileModel = profile.agents[agentName] ?? null;
        if (currentModel !== profileModel) {
            return false;
        }
    }

    return true;
}

function listProfiles(profilesPath: string, configPath: string): AppResult<string> {
    const profilesResult = readJsonc<unknown>(profilesPath);
    if (profilesResult.isErr()) {
        return err(`failed to parse profiles: ${profilesResult.error}`);
    }
    const configResult = readJsonc<unknown>(configPath);
    if (configResult.isErr()) {
        return err(`failed to parse config: ${configResult.error}`);
    }

    const profilesParsed = ProfilesSchema.safeParse(profilesResult.value);
    if (!profilesParsed.success) {
        return err("profiles file missing valid profiles object");
    }
    const configParsed = ConfigSchema.safeParse(configResult.value);
    if (!configParsed.success) {
        return err("config file invalid");
    }

    const config = configResult.value as ConfigShape;
    const snapshot = currentSnapshot(config);
    const items = Object.entries(profilesParsed.data.profiles).map(([name, value]) => {
        const profile = profileSpecFromParsed(value);
        return {
            name,
            description: profile.description,
            active: profileMatches(snapshot, profile),
        };
    });

    return ok(JSON.stringify({ profiles: items }));
}

function applyProfile(profilesPath: string, configPath: string, profileName: string): AppResult<string> {
    const profilesResult = readJsonc<unknown>(profilesPath);
    if (profilesResult.isErr()) {
        return err(`failed to parse profiles: ${profilesResult.error}`);
    }
    const configResult = readJsonc<unknown>(configPath);
    if (configResult.isErr()) {
        return err(`failed to parse config: ${configResult.error}`);
    }

    const profilesParsed = ProfilesSchema.safeParse(profilesResult.value);
    if (!profilesParsed.success) {
        return err("profiles file missing valid profiles object");
    }
    const configParsed = ConfigSchema.safeParse(configResult.value);
    if (!configParsed.success) {
        return err("config file invalid");
    }

    const target = profilesParsed.data.profiles[profileName];
    if (!target) {
        return err(`missing profile: ${profileName}`);
    }

    const profile = profileSpecFromParsed(target);
    const nextConfig: ConfigShape = structuredClone(configResult.value as ConfigShape);

    if (profile.model !== null) {
        nextConfig.model = profile.model;
    }
    if (profile.small_model !== null) {
        nextConfig.small_model = profile.small_model;
    }

    const existingAgents = nextConfig.agent || {};
    const updatedAgents: Record<string, { model?: string }> = {};

    for (const [agentName, agentValue] of Object.entries(existingAgents)) {
        const nextModel = profile.agents[agentName];
        const currentAgent = { ...(agentValue || {}) };
        if (nextModel === undefined) {
            delete currentAgent.model;
        } else if (nextModel === null) {
            delete currentAgent.model;
        } else {
            currentAgent.model = nextModel;
        }
        updatedAgents[agentName] = currentAgent;
    }

    for (const [agentName, agentModel] of Object.entries(profile.agents)) {
        if (!(agentName in updatedAgents) && agentModel !== null) {
            updatedAgents[agentName] = { model: agentModel };
        }
    }

    nextConfig.agent = updatedAgents;

    try {
        writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }

    return ok(
        JSON.stringify({
            profile: profileName,
            description: profile.description,
        }),
    );
}

function usage(): void {
    console.log("Usage:");
    console.log("  opencode_profile_switch_helper.ts list <profiles.jsonc> <opencode.json/jsonc>");
    console.log("  opencode_profile_switch_helper.ts apply <profiles.jsonc> <opencode.json/jsonc> <profile>");
}

function main(): number {
    const [, , command, ...args] = process.argv;
    if (!command || command === "-h" || command === "--help") {
        usage();
        return command ? 0 : 1;
    }

    const result =
        command === "list"
            ? args.length === 2
                ? listProfiles(args[0], args[1])
                : err("list requires 2 args")
            : command === "apply"
              ? args.length === 3
                  ? applyProfile(args[0], args[1], args[2])
                  : err("apply requires 3 args")
              : err(`unknown command: ${command}`);

    if (result.isErr()) {
        console.error(`opencode_profile_switch_helper: ${result.error}`);
        return 1;
    }

    console.log(result.value);
    return 0;
}

process.exit(main());
