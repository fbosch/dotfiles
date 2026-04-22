#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

type AppResult<T> = Result<T, string>;

type ParsedTestCase = {
    markdown: string;
};

const ArgsSchema = z.object({
    testCaseId: z.string().regex(/^\d+$/, "ID must be numeric"),
});

const EnvSchema = z.object({
    ADO_TEST_CASE_ORG_URL: z.string().url().optional(),
    ADO_TEST_CASE_CACHE_DIR: z.string().min(1).default("/tmp/azure-devops-cache"),
    ADO_TEST_CASE_REFRESH: z
        .preprocess((value) => {
            if (value === undefined) {
                return undefined;
            }
            if (typeof value !== "string") {
                return value;
            }

            const normalized = value.trim().toLowerCase();
            if (["1", "true", "yes", "on"].includes(normalized)) {
                return true;
            }
            if (["0", "false", "no", "off"].includes(normalized)) {
                return false;
            }

            return value;
        }, z.boolean())
        .default(false),
});

const AzureWorkItemSchema = z
    .object({
        fields: z.record(z.string(), z.unknown()).default({}),
    })
    .passthrough();

const AssignedToSchema = z
    .object({
        displayName: z.string().min(1),
    })
    .passthrough();

function usage(): void {
    console.log("Usage: ado_test_case_helper.ts <ID>");
    console.log("Env overrides:");
    console.log("  ADO_TEST_CASE_ORG_URL");
    console.log("  ADO_TEST_CASE_CACHE_DIR      default /tmp/azure-devops-cache");
    console.log("  ADO_TEST_CASE_REFRESH        default 0");
}

function run(command: string, args: string[], input?: string): AppResult<string> {
    const result = spawnSync(command, args, {
        encoding: "utf8",
        input,
        stdio: "pipe",
    });

    if (result.status !== 0) {
        const output = (result.stderr || result.stdout || `${command} failed`).trim();
        return err(output);
    }

    return ok(result.stdout);
}

function ensureCacheDir(cacheDir: string): AppResult<void> {
    try {
        mkdirSync(cacheDir, { recursive: true });
        return ok(undefined);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

function fetchOrLoadTestCase(
    testCaseId: string,
    cacheDir: string,
    orgUrl?: string,
    refresh = false,
): AppResult<string> {
    const ensureCacheDirResult = ensureCacheDir(cacheDir);
    if (ensureCacheDirResult.isErr()) {
        return err(ensureCacheDirResult.error);
    }

    const cacheFile = join(cacheDir, `test_case_${testCaseId}.json`);
    if (!refresh && existsSync(cacheFile)) {
        try {
            return ok(readFileSync(cacheFile, "utf8"));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return err(message);
        }
    }

    const args = ["boards", "work-item", "show", "--id", testCaseId, "--output", "json"];
    if (orgUrl) {
        args.push("--org", orgUrl);
    }

    const fetchResult = run("az", args);
    if (fetchResult.isErr()) {
        if (existsSync(cacheFile)) {
            rmSync(cacheFile, { force: true });
        }
        return err(fetchResult.error);
    }

    try {
        writeFileSync(cacheFile, fetchResult.value, "utf8");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }

    return ok(fetchResult.value);
}

function htmlToText(value: string, width = 80): string {
    if (!value.trim()) {
        return "";
    }

    const result = run("html2text", ["-utf8", "-nobs", "-width", String(width)], value);
    if (result.isErr()) {
        return value.trim();
    }

    return result.value.trim();
}

function decodeXmlEntities(value: string): string {
    return value
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'")
        .replaceAll("&amp;", "&");
}

function markdownEscape(value: string): string {
    return value.replaceAll("|", "\\|").replaceAll("\n", " ").trim();
}

function parseStepsTable(stepsRaw: string): string {
    if (!stepsRaw.trim()) {
        return "";
    }

    const stepBlocks = [...stepsRaw.matchAll(/<step\b[\s\S]*?<\/step>/g)].map((match) => match[0]);
    if (stepBlocks.length === 0) {
        return "";
    }

    const rows = ["| Step | Action | Expected Result |", "|------|--------|----------------|"];
    let stepNumber = 1;

    for (const stepBlock of stepBlocks) {
        const paramValues = [...stepBlock.matchAll(/<parameterizedString[^>]*>([\s\S]*?)<\/parameterizedString>/g)].map(
            (match) => match[1] || "",
        );

        if (paramValues.length === 0) {
            continue;
        }

        const action = htmlToText(decodeXmlEntities(paramValues[0] || ""), 1000)
            .replaceAll("\n", " ")
            .trim();
        const expected = htmlToText(decodeXmlEntities(paramValues[1] || ""), 1000)
            .replaceAll("\n", " ")
            .trim();
        if (!action) {
            continue;
        }

        rows.push(`| ${stepNumber} | ${markdownEscape(action)} | ${markdownEscape(expected)} |`);
        stepNumber += 1;
    }

    return rows.length > 2 ? rows.join("\n") : "";
}

function fieldAsString(fields: Record<string, unknown>, key: string, fallback: string): string {
    const value = fields[key];
    return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function assignedToDisplay(fields: Record<string, unknown>): string {
    const parsed = AssignedToSchema.safeParse(fields["System.AssignedTo"]);
    return parsed.success ? parsed.data.displayName : "Unassigned";
}

function parseTestCaseMarkdown(rawJson: string, testCaseId: string): AppResult<ParsedTestCase> {
    let parsedJson: unknown;
    try {
        parsedJson = JSON.parse(rawJson);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }

    const parsed = AzureWorkItemSchema.safeParse(parsedJson);
    if (!parsed.success) {
        const summary = parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
            .join("; ");
        return err(`invalid Azure work item payload (${summary})`);
    }

    const fields = parsed.data.fields;
    const title = fieldAsString(fields, "System.Title", "N/A");
    const state = fieldAsString(fields, "System.State", "N/A");
    const areaPath = fieldAsString(fields, "System.AreaPath", "N/A");
    const iteration = fieldAsString(fields, "System.IterationPath", "N/A");
    const descriptionRaw = fieldAsString(fields, "System.Description", "");
    const stepsRaw = fieldAsString(fields, "Microsoft.VSTS.TCM.Steps", "");
    const description = htmlToText(descriptionRaw, 80);
    const steps = parseStepsTable(stepsRaw);

    const markdown = [
        `# Test Case #${testCaseId}: ${title}`,
        "",
        "## Details",
        `- **State:** ${state}`,
        `- **Assigned To:** ${assignedToDisplay(fields)}`,
        `- **Area Path:** ${areaPath}`,
        `- **Iteration:** ${iteration}`,
        "",
        "## Description",
        description,
        "",
        "## Test Steps",
        steps,
    ].join("\n");

    return ok({ markdown });
}

function main(): number {
    const [, , firstArg] = process.argv;
    if (!firstArg || firstArg === "-h" || firstArg === "--help") {
        usage();
        return firstArg ? 0 : 1;
    }

    const parsedArgs = ArgsSchema.safeParse({ testCaseId: firstArg });
    if (!parsedArgs.success) {
        const summary = parsedArgs.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
        console.error(`ado_test_case_helper: invalid args (${summary})`);
        return 1;
    }

    const parsedEnv = EnvSchema.safeParse(process.env);
    if (!parsedEnv.success) {
        const summary = parsedEnv.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
        console.error(`ado_test_case_helper: invalid env (${summary})`);
        return 1;
    }

    const rawResult = fetchOrLoadTestCase(
        parsedArgs.data.testCaseId,
        parsedEnv.data.ADO_TEST_CASE_CACHE_DIR,
        parsedEnv.data.ADO_TEST_CASE_ORG_URL,
        parsedEnv.data.ADO_TEST_CASE_REFRESH,
    );
    if (rawResult.isErr()) {
        console.error(`ado_test_case_helper: ${rawResult.error}`);
        return 1;
    }

    const markdownResult = parseTestCaseMarkdown(rawResult.value, parsedArgs.data.testCaseId);
    if (markdownResult.isErr()) {
        console.error(`ado_test_case_helper: ${markdownResult.error}`);
        return 1;
    }

    console.log(markdownResult.value.markdown);
    return 0;
}

process.exit(main());
