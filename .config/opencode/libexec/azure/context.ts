import { err, ok } from "neverthrow";
import { runCommand, type AppResult } from "../shared/process.js";

type ParsedContext = {
    org: string | null;
    project: string | null;
};

function decodeSegment(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

export function parseOrgAndProject(value: string): ParsedContext {
    const text = value.trim();
    if (text.startsWith("http") === false) {
        return { org: null, project: null };
    }

    let parsed: URL;
    try {
        parsed = new URL(text);
    } catch {
        return { org: null, project: null };
    }

    const host = parsed.hostname.toLowerCase();
    const segments = parsed.pathname
        .split("/")
        .filter((segment) => segment.length > 0)
        .map(decodeSegment);

    if (host.endsWith("dev.azure.com")) {
        if (segments.length < 2) {
            return { org: null, project: null };
        }

        return {
            org: `https://dev.azure.com/${segments[0]}`,
            project: segments[1],
        };
    }

    if (host.endsWith("visualstudio.com")) {
        return {
            org: `${parsed.protocol}//${parsed.host}`,
            project: segments[0] ?? null,
        };
    }

    return { org: null, project: null };
}

export function detectOrgFromGitRemote(): string | null {
    const remoteResult = runCommand("git", ["config", "--get", "remote.origin.url"], helperCwdOptions());
    if (remoteResult.isErr()) {
        return null;
    }

    const remote = remoteResult.value.trim();
    if (remote === "") {
        return null;
    }

    const devAzureMatch = remote.match(/dev\.azure\.com\/([^/]+)\//);
    if (devAzureMatch?.[1]) {
        return `https://dev.azure.com/${devAzureMatch[1]}`;
    }

    const visualStudioMatch = remote.match(/https:\/\/([^.]+)\.visualstudio\.com/);
    if (visualStudioMatch?.[1]) {
        return `https://${visualStudioMatch[1]}.visualstudio.com`;
    }

    return null;
}

export function getCurrentBranch(): string {
    const branchResult = runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], helperCwdOptions());
    if (branchResult.isErr()) {
        return "";
    }

    return branchResult.value.trim();
}

export function inferPbiIdFromBranch(branchName: string): string | null {
    if (branchName === "") {
        return null;
    }

    const patterns = [
        /AB#(\d+)/i,
        /(?:^|[/-])(?:pbi|wi|workitem|work-item)[-_]?(\d+)(?:$|[/-])/i,
        /(?<!\d)(\d{4,})(?!\d)/,
    ];

    for (const pattern of patterns) {
        const match = branchName.match(pattern);
        if (match?.[1]) {
            return match[1];
        }
    }

    return null;
}

export function extractWorkItemId(value: string): string | null {
    const text = value.trim();
    if (/^\d+$/.test(text)) {
        return text;
    }

    const patterns = [/_workitems\/edit\/(\d+)/i, /[?&]id=(\d+)/i, /\b(\d+)\b/];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) {
            return match[1];
        }
    }

    return null;
}

export function azureEnv(): NodeJS.ProcessEnv {
    return {
        ...process.env,
        AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "yes_without_prompt",
    };
}

export function requireNumericId(id: string, label: string): AppResult<string> {
    if (/^\d+$/.test(id)) {
        return ok(id);
    }

    return err(`Invalid ${label} ID. Must be numeric.`);
}

function helperCwdOptions(): { cwd?: string } {
    const cwd = process.env.OPENCODE_LIBEXEC_CWD;
    return cwd ? { cwd } : {};
}
