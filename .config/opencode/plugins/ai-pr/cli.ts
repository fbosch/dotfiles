#!/usr/bin/env bun

import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { spinner } from "@clack/prompts";

const DEFAULT_MODEL = "opencode/big-pickle";
const DEFAULT_SERVER_URL = "http://127.0.0.1:4096";
const START_TIMEOUT_MS = 12000;
const SESSION_TIMEOUT_MS = 5000;
const DEFAULT_COMMAND_TIMEOUT_MS = 120000;
const MAX_DIFF_LINES = 2000;
const TRUNCATED_DIFF_LINES = 500;
const ANSI_ESCAPE_REGEX = new RegExp("\\u001b\\[[0-9;]*m", "g");
const SERVER_READY_PATTERN = /on\s+(https?:\/\/[^\s]+)/;
type CliArgs = {
  debug?: boolean;
  modelRef?: string;
};

type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
};

type CommandEnv = Record<string, string | undefined>;

type ConnectedServer = {
  baseUrl: string;
  cleanup?: () => Promise<void>;
};

type ComparisonRange = {
  mergeBase: string;
  commitSubjects: string[];
};

function parseArgs(argv: string[]): CliArgs {
  let debug = false;
  let modelRef: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--debug") {
      debug = true;
      continue;
    }

    if (value === "-m" || value === "--model") {
      const next = argv[index + 1];
      if (typeof next !== "string" || next.trim().length === 0) {
        fail("Missing value for --model");
      }
      modelRef = next.trim();
      index += 1;
      continue;
    }

    if (value.startsWith("--model=")) {
      const provided = value.slice("--model=".length).trim();
      if (provided.length === 0) {
        fail("Missing value for --model");
      }
      modelRef = provided;
      continue;
    }

    fail(`Unknown argument: ${value}`);
  }

  return { debug, modelRef };
}

function runCommand(
  command: string,
  args: string[],
  options?: {
    stdin?: string;
    env?: CommandEnv;
    inheritIO?: boolean;
  },
): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input: options?.stdin,
    env: options?.env,
    stdio: options?.inheritIO === true ? "inherit" : "pipe",
  });

  if (result.error !== undefined) {
    fail(`${command}: ${result.error.message}`);
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function startDebugTimer(debug: boolean): number | null {
  return debug ? performance.now() : null;
}

function writeDebugTiming(
  debug: boolean,
  label: string,
  startTime: number | null,
): void {
  if (debug === false || startTime === null) {
    return;
  }

  const elapsedMs = performance.now() - startTime;
  process.stderr.write("\x1b[2K\r");
  console.error(`[ai-pr] ${label}: ${elapsedMs.toFixed(1)}ms`);
}

function commandExists(command: string): boolean {
  const result = runCommand("which", [command]);
  return result.status === 0;
}

function style(message: string, color?: 1 | 2 | 3): void {
  if (commandExists("gum") === false) {
    console.log(message);
    return;
  }

  const args = ["style"];
  if (typeof color === "number") {
    args.push("--foreground", String(color));
  }
  args.push(message);

  runCommand("gum", args, { inheritIO: true });
}

function fail(message: string): never {
  style(` ${message}`, 1);
  process.exit(1);
  throw new Error(message);
}

function isInGitRepo(): boolean {
  return runCommand("git", ["rev-parse", "--git-dir"]).status === 0;
}

function getMainBranch(): string {
  if (
    runCommand("git", ["show-ref", "--verify", "--quiet", "refs/heads/main"])
      .status === 0
  ) {
    return "main";
  }

  if (
    runCommand("git", ["show-ref", "--verify", "--quiet", "refs/heads/master"])
      .status === 0
  ) {
    return "master";
  }

  return fail("Could not find main or master branch");
}

function getUpstreamBranch(): string | null {
  const result = runCommand("git", [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]);
  if (result.status !== 0) {
    return null;
  }

  const upstream = result.stdout.trim();
  return upstream.length > 0 ? upstream : null;
}

function getComparisonRange(baseRef: string): ComparisonRange {
  const mergeBaseResult = runCommand("git", ["merge-base", "HEAD", baseRef]);
  if (mergeBaseResult.status !== 0) {
    fail(`Failed to determine merge base for ${baseRef}`);
  }

  const mergeBase = mergeBaseResult.stdout.trim();
  if (mergeBase.length === 0) {
    fail(`Failed to determine merge base for ${baseRef}`);
  }

  const commitsResult = runCommand("git", [
    "log",
    `${mergeBase}..HEAD`,
    "--pretty=format:%s",
    "--no-merges",
  ]);
  if (commitsResult.status !== 0) {
    fail("Failed to read commit messages");
  }

  return {
    mergeBase,
    commitSubjects: commitsResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  };
}

function buildPromptInput(
  branchName: string,
  baseRef: string,
  commitSubjects: string[],
  diff: string,
): string {
  const sections = [
    `Branch: ${branchName}`,
    `Base: ${baseRef}`,
    "Commits:",
    commitSubjects.length > 0
      ? commitSubjects.map((subject) => `- ${subject}`).join("\n")
      : "(none)",
    "",
    "DIFF:",
    diff,
  ];

  return sections.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function getCommandTimeoutMs(): number {
  const raw = process.env.AI_PR_TIMEOUT_MS;
  if (typeof raw !== "string") {
    return DEFAULT_COMMAND_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) === false || parsed < 5000) {
    return DEFAULT_COMMAND_TIMEOUT_MS;
  }

  return parsed;
}

function extractSessionId(value: unknown): string | null {
  if (
    isRecord(value) &&
    isRecord(value.data) &&
    typeof value.data.id === "string"
  ) {
    return value.data.id;
  }

  if (isRecord(value) && typeof value.id === "string") {
    return value.id;
  }

  return null;
}

function extractTextParts(value: unknown): string[] {
  const parts =
    isRecord(value) && isRecord(value.data) && Array.isArray(value.data.parts)
      ? value.data.parts
      : isRecord(value) && Array.isArray(value.parts)
        ? value.parts
        : [];

  const textParts: string[] = [];
  for (const part of parts) {
    if (isRecord(part) === false) {
      continue;
    }

    if (typeof part.text === "string") {
      textParts.push(part.text);
      continue;
    }

    if (isRecord(part.part) && typeof part.part.text === "string") {
      textParts.push(part.part.text);
    }
  }

  return textParts;
}

async function withSpinner<T>(
  debug: boolean,
  title: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (process.stderr.isTTY === false) {
    return await fn();
  }

  const activeSpinner = spinner();
  activeSpinner.start(title);

  try {
    const result = await fn();
    activeSpinner.stop("Done");
    return result;
  } catch (error) {
    activeSpinner.stop("Failed");
    throw error;
  }
}

async function requestOpencode(
  baseUrl: string,
  path: string,
  method: "GET" | "POST" | "DELETE",
  timeoutMs: number,
  body?: unknown,
): Promise<unknown> {
  const url = new URL(path, baseUrl);
  url.searchParams.set("directory", process.cwd());
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-opencode-directory": process.cwd(),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await withTimeout(
    fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    timeoutMs,
    `${method} ${path}`,
  );

  const text = await response.text();
  if (response.ok === false) {
    const detail = text.trim();
    throw new Error(
      detail.length > 0
        ? `OpenCode ${method} ${path} failed (${response.status}): ${detail}`
        : `OpenCode ${method} ${path} failed (${response.status})`,
    );
  }

  if (text.trim().length === 0) {
    return {};
  }

  return JSON.parse(text) as unknown;
}

async function canUseServer(baseUrl: string): Promise<boolean> {
  try {
    await requestOpencode(
      baseUrl,
      "/session/status",
      "GET",
      SESSION_TIMEOUT_MS,
    );
    return true;
  } catch {
    return false;
  }
}

async function connectOpenCode(): Promise<ConnectedServer> {
  const useExisting = process.env.AI_PR_USE_EXISTING_SERVER !== "0";
  if (useExisting && (await canUseServer(DEFAULT_SERVER_URL))) {
    return { baseUrl: DEFAULT_SERVER_URL };
  }

  return await startOpenCodeServer();
}

async function startOpenCodeServer(): Promise<ConnectedServer> {
  return await withTimeout(
    new Promise<ConnectedServer>((resolve, reject) => {
      const child = spawn(
        "opencode",
        ["serve", "--hostname=127.0.0.1", "--port=0"],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      let settled = false;
      let stdoutBuffer = "";
      let stderrBuffer = "";

      const finishError = (message: string): void => {
        if (settled) {
          return;
        }

        settled = true;
        child.kill();
        reject(new Error(message));
      };

      const finishSuccess = (baseUrl: string): void => {
        if (settled) {
          return;
        }

        settled = true;
        resolve({
          baseUrl,
          cleanup: async () => {
            if (child.killed === false) {
              child.kill();
            }
          },
        });
      };

      child.once("error", (error) => {
        finishError(`Failed to start OpenCode server: ${error.message}`);
      });

      child.once("exit", (code, signal) => {
        if (settled) {
          return;
        }

        const suffix = signal
          ? ` (${signal})`
          : typeof code === "number"
            ? ` (${code})`
            : "";
        const detail = stderrBuffer.trim();
        finishError(
          detail.length > 0
            ? `OpenCode server exited before startup${suffix}: ${detail}`
            : `OpenCode server exited before startup${suffix}`,
        );
      });

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdoutBuffer += chunk;
        const match = SERVER_READY_PATTERN.exec(stdoutBuffer);
        if (match?.[1]) {
          finishSuccess(match[1]);
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderrBuffer += chunk;
      });
    }),
    START_TIMEOUT_MS,
    "OpenCode server startup",
  );
}

async function createSession(baseUrl: string): Promise<string> {
  const response = await requestOpencode(
    baseUrl,
    "/session",
    "POST",
    SESSION_TIMEOUT_MS,
    { title: "ai-pr" },
  );
  const sessionId = extractSessionId(response);
  if (sessionId === null) {
    throw new Error("Failed to create OpenCode session");
  }

  return sessionId;
}

async function deleteSession(
  baseUrl: string,
  sessionId: string,
): Promise<void> {
  try {
    await requestOpencode(
      baseUrl,
      `/session/${encodeURIComponent(sessionId)}`,
      "DELETE",
      SESSION_TIMEOUT_MS,
    );
  } catch {
    return;
  }
}

async function runPrDescCommand(
  baseUrl: string,
  sessionId: string,
  modelRef: string,
  diff: string,
): Promise<string> {
  const response = await requestOpencode(
    baseUrl,
    `/session/${encodeURIComponent(sessionId)}/command`,
    "POST",
    getCommandTimeoutMs(),
    {
      arguments: diff,
      command: "pr-desc",
      model: modelRef,
    },
  );

  return extractTextParts(response).join("\n").trim();
}

function getClipboardCommand(): { command: string; args: string[] } | null {
  if (process.platform === "darwin") {
    if (commandExists("pbcopy")) {
      return { command: "pbcopy", args: [] };
    }
    return null;
  }

  if (process.platform === "linux") {
    if (commandExists("wl-copy")) {
      return { command: "wl-copy", args: [] };
    }

    if (commandExists("xclip")) {
      return { command: "xclip", args: ["-selection", "clipboard"] };
    }
  }

  return null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const debug = args.debug === true;
  const modelRef = args.modelRef ?? DEFAULT_MODEL;
  const totalStart = startDebugTimer(debug);

  const repoCheckStart = startDebugTimer(debug);
  const inGitRepo = isInGitRepo();
  writeDebugTiming(debug, "isInGitRepo", repoCheckStart);
  if (inGitRepo === false) {
    fail("Not in a git repository");
  }

  const branchStart = startDebugTimer(debug);
  const branchResult = runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  writeDebugTiming(debug, "getCurrentBranch", branchStart);
  if (branchResult.status !== 0) {
    fail("Failed to read current branch");
  }
  const branchName = branchResult.stdout.trim();

  const mainBranchStart = startDebugTimer(debug);
  const mainBranch = getMainBranch();
  writeDebugTiming(debug, "getMainBranch", mainBranchStart);
  let comparisonRef = mainBranch;
  let comparisonLabel = mainBranch;

  if (branchName === mainBranch) {
    const upstreamStart = startDebugTimer(debug);
    const upstreamBranch = getUpstreamBranch();
    writeDebugTiming(debug, "getUpstreamBranch", upstreamStart);

    if (upstreamBranch === null) {
      fail(
        `Current branch is ${mainBranch} and has no upstream branch to compare against`,
      );
    }

    comparisonRef = upstreamBranch;
    comparisonLabel = `upstream ${upstreamBranch}`;
  }

  const commitSubjectsStart = startDebugTimer(debug);
  const comparisonRange = getComparisonRange(comparisonRef);
  writeDebugTiming(debug, "gitCommits", commitSubjectsStart);

  const diffStatStart = startDebugTimer(debug);
  const diffStatResult = runCommand("git", [
    "diff",
    `${comparisonRange.mergeBase}..HEAD`,
    "--stat",
  ]);
  writeDebugTiming(debug, "gitDiffStat", diffStatStart);
  if (diffStatResult.status !== 0) {
    fail("Failed to read branch diff");
  }
  if (diffStatResult.stdout.trim().length === 0) {
    fail(`No differences found between ${branchName} and ${comparisonLabel}`);
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "ai-pr."));
  const tempDiff = join(tempRoot, "pr_diff.patch");
  const tempDiffSummary = join(tempRoot, "pr_diff_summary.patch");
  const tempPrDesc = join(tempRoot, "pr_description.md");
  let cleanupServer: (() => Promise<void>) | null = null;

  const cleanup = (): void => {
    rmSync(tempRoot, { recursive: true, force: true });
  };

  const exitWithCleanup = (): void => {
    cleanup();
    const stopServer = cleanupServer;
    if (stopServer === null) {
      process.exit(130);
      throw new Error("Signal exit");
    }

    void stopServer().finally(() => {
      process.exit(130);
    });
  };

  process.on("SIGINT", exitWithCleanup);

  process.on("SIGTERM", exitWithCleanup);

  const fullDiffStart = startDebugTimer(debug);
  const fullDiff = runCommand("git", [
    "diff",
    `${comparisonRange.mergeBase}..HEAD`,
  ]);
  writeDebugTiming(debug, "gitDiff", fullDiffStart);
  if (fullDiff.status !== 0) {
    cleanup();
    fail("Failed to generate diff");
  }

  writeFileSync(tempDiff, fullDiff.stdout);
  const diffLines = fullDiff.stdout.split(/\r?\n/);
  const diffLineCount = diffLines.length;

  const actualDiffFile =
    diffLineCount > MAX_DIFF_LINES ? tempDiffSummary : tempDiff;

  if (diffLineCount > MAX_DIFF_LINES) {
    const truncatedLines = diffLines.slice(0, TRUNCATED_DIFF_LINES).join("\n");
    const summary = [
      diffStatResult.stdout.trimEnd(),
      "",
      "(Diff is too large to include in full. Showing file changes only. Focus on the commit messages and file list above for context.)",
      truncatedLines,
      "",
      `... (diff truncated, ${diffLineCount} total lines) ...`,
      "",
    ].join("\n");

    writeFileSync(tempDiffSummary, summary);
  }

  const diffInput = buildPromptInput(
    branchName,
    comparisonRef,
    comparisonRange.commitSubjects,
    readFileSync(actualDiffFile, "utf8"),
  );
  const opencodeStart = startDebugTimer(debug);
  const opencodeState: {
    connected: ConnectedServer | null;
    sessionId: string | null;
  } = {
    connected: null,
    sessionId: null,
  };
  let parsed = "";

  try {
    parsed = await withSpinner(debug, `Analyzing commits ...`, async () => {
      const connectStart = startDebugTimer(debug);
      opencodeState.connected = await connectOpenCode();
      cleanupServer = opencodeState.connected.cleanup ?? null;
      writeDebugTiming(debug, "connectClient", connectStart);

      const createSessionStart = startDebugTimer(debug);
      opencodeState.sessionId = await createSession(
        opencodeState.connected.baseUrl,
      );
      writeDebugTiming(debug, "session.create", createSessionStart);

      const commandStart = startDebugTimer(debug);
      const result = await runPrDescCommand(
        opencodeState.connected.baseUrl,
        opencodeState.sessionId,
        modelRef,
        diffInput,
      );
      writeDebugTiming(debug, "session.command", commandStart);
      return result;
    });
  } catch (error) {
    cleanup();
    throw error;
  } finally {
    if (opencodeState.connected !== null && opencodeState.sessionId !== null) {
      const deleteSessionStart = startDebugTimer(debug);
      await deleteSession(
        opencodeState.connected.baseUrl,
        opencodeState.sessionId,
      );
      writeDebugTiming(debug, "session.delete", deleteSessionStart);
    }

    if (
      opencodeState.connected !== null &&
      typeof opencodeState.connected.cleanup === "function"
    ) {
      await opencodeState.connected.cleanup().catch(() => undefined);
      cleanupServer = null;
    }

    writeDebugTiming(debug, "opencode", opencodeStart);
  }

  writeFileSync(tempPrDesc, parsed);

  if (parsed.length === 0) {
    style(" No valid PR description generated", 1);
    writeDebugTiming(debug, "total", totalStart);
    cleanup();
    process.exit(1);
  }

  const editorStart = startDebugTimer(debug);
  runCommand(
    "nvim",
    [
      "-f",
      "--cmd",
      "set noswapfile nobackup nowritebackup",
      "-c",
      "set filetype=markdown wrap linebreak spell textwidth=0 wrapmargin=0 nolist conceallevel=0",
      "-c",
      "set formatoptions-=t formatoptions+=l",
      "-c",
      "autocmd VimLeavePre * silent! write",
      "-c",
      "set statusline=%f\\ %=[PR\\ Description\\ -\\ exit\\ to\\ copy\\ to\\ clipboard] | normal! gg",
      tempPrDesc,
    ],
    { inheritIO: true },
  );
  writeDebugTiming(debug, "editor", editorStart);

  try {
    statSync(tempPrDesc);
  } catch {
    style(" PR description cancelled", 1);
    cleanup();
    process.exit(1);
  }

  const finalContent = readFileSync(tempPrDesc, "utf8");
  if (finalContent.trim().length === 0) {
    style(" PR description cancelled (empty content)", 1);
    cleanup();
    process.exit(1);
  }

  const clipboard = getClipboardCommand();
  if (clipboard === null) {
    style(" Clipboard command not found, displaying content:", 3);
    console.log(finalContent);
    writeDebugTiming(debug, "total", totalStart);
    cleanup();
    return;
  }

  const clipboardStart = startDebugTimer(debug);
  const clipboardResult = runCommand(clipboard.command, clipboard.args, {
    stdin: finalContent.replace(ANSI_ESCAPE_REGEX, ""),
  });
  writeDebugTiming(debug, "clipboard", clipboardStart);

  if (clipboardResult.status === 0) {
    style(" PR description copied to clipboard!", 2);
  } else {
    style(" Failed to copy to clipboard", 1);
  }

  writeDebugTiming(debug, "total", totalStart);
  cleanup();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(`Failed with unexpected error: ${message}`);
});
