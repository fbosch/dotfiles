import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { placeholder } from "../extensions/context-masking/policy";

// The sandbox wrapper on PATH cannot nest inside an existing sandbox; PI_BIN points at
// the unwrapped runtime, which still inherits the caller's sandbox restrictions.
const PI_BIN = process.env.PI_BIN ?? "pi";

// Live probe: builds sessions whose old tool results are already masked by the real
// placeholder text, asks a question that needs one of them, and records whether the model
// recalls the artifact, re-runs the original tool, or answers without checking.

export interface ProbeCase {
  name: string;
  /** Tool and arguments of the masked call. */
  tool: "bash" | "read";
  args: Record<string, string>;
  /** Files present in the working directory during the probe. */
  files: Record<string, string>;
  maskedText: string;
  question: string;
  answer: string;
  /** Whether answering requires the masked content at all. */
  needsRecall: boolean;
  /** Compact after masking with a summary that omits the placeholder, as a lossy summary would. */
  compacted?: boolean;
}

const filler = (label: string, lines: number) =>
  Array.from({ length: lines }, (_, i) => `${label} ${i}: ok ${(i * 7919) % 1000}`).join("\n");

export function probeCases(token = () => randomBytes(4).toString("hex")): ProbeCase[] {
  const checksum = `mc-${token()}`;
  const codename = `${token()}-heron`;
  const salt = `salt-${token()}`;
  const configText = [
    "// Generated shard configuration.",
    filler("shard", 60),
    `export const SHARD_SALT = "${salt}";`,
    filler("replica", 60),
  ].join("\n");
  return [
    {
      name: "gone-command",
      tool: "bash",
      args: { command: "./scripts/collect-diagnostics.sh" },
      files: {},
      maskedText: [filler("diag", 80), `migration checksum: ${checksum}`, filler("tail", 40)].join(
        "\n",
      ),
      question:
        "Earlier, the diagnostics script printed a migration checksum. What was it? Reply with only the checksum.",
      answer: checksum,
      needsRecall: true,
    },
    {
      name: "deleted-file",
      tool: "read",
      args: { path: "notes/design.md" },
      files: {},
      maskedText: [
        "# Design notes",
        filler("section", 70),
        `Retry policy owner codename: ${codename}`,
        filler("appendix", 50),
      ].join("\n"),
      question:
        "The design notes we read earlier named a retry policy owner codename. What was it? Reply with only the codename.",
      answer: codename,
      needsRecall: true,
    },
    {
      name: "file-present",
      tool: "read",
      args: { path: "src/config.ts" },
      files: { "src/config.ts": configText },
      maskedText: configText,
      question: "What is the value of SHARD_SALT in src/config.ts? Reply with only the value.",
      answer: salt,
      needsRecall: true,
    },
    {
      name: "compacted-command",
      tool: "bash",
      args: { command: "./scripts/collect-diagnostics.sh" },
      files: {},
      maskedText: [filler("diag", 80), `migration checksum: ${checksum}`, filler("tail", 40)].join(
        "\n",
      ),
      question:
        "Earlier, the diagnostics script printed a migration checksum. What was it? Reply with only the checksum.",
      answer: checksum,
      needsRecall: true,
      compacted: true,
    },
    {
      name: "control",
      tool: "bash",
      args: { command: "./scripts/collect-diagnostics.sh" },
      files: {},
      maskedText: [filler("diag", 80), `migration checksum: ${checksum}`].join("\n"),
      question: "What is 17 * 23? Reply with only the number.",
      answer: "391",
      needsRecall: false,
    },
  ];
}

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

// shortcut: synthetic history uses a foreign provider so Pi normalizes it for the probe model;
// replace with recorded sessions if foreign-history conversion turns out to change behavior.
function assistant(content: unknown[]) {
  return {
    role: "assistant" as const,
    content,
    api: "anthropic-messages",
    provider: "synthetic",
    model: "history",
    usage: USAGE,
    stopReason: content.some((b) => (b as { type: string }).type === "toolCall")
      ? ("toolUse" as const)
      : ("stop" as const),
    timestamp: Date.now(),
  } as Parameters<SessionManager["appendMessage"]>[0];
}

/** Writes a session: task, masked call, ten small filler turns, then a closing reply. */
export async function buildSession(
  probe: ProbeCase,
  dir: string,
): Promise<{ sessionFile: string; artifactPath: string; cwd: string }> {
  const cwd = join(dir, "work");
  await mkdir(cwd, { recursive: true });
  for (const [path, text] of Object.entries(probe.files)) {
    await mkdir(join(cwd, path, ".."), { recursive: true });
    await writeFile(join(cwd, path), text);
  }
  const manager = SessionManager.inMemory(cwd);
  manager.appendMessage({
    role: "user",
    content: "Investigate why the nightly migration job is slow and report back.",
    timestamp: Date.now(),
  });
  const callId = "toolu_masked0";
  manager.appendMessage(
    assistant([{ type: "toolCall", id: callId, name: probe.tool, arguments: probe.args }]),
  );
  const maskedId = manager.appendMessage({
    role: "toolResult",
    toolCallId: callId,
    toolName: probe.tool,
    content: [{ type: "text", text: probe.maskedText }],
    isError: false,
    timestamp: Date.now(),
  });
  for (let i = 0; i < 10; i++) {
    const id = `toolu_filler${i}`;
    manager.appendMessage(
      assistant([
        { type: "toolCall", id, name: "bash", arguments: { command: `ls jobs/batch-${i}` } },
      ]),
    );
    manager.appendMessage({
      role: "toolResult",
      toolCallId: id,
      toolName: "bash",
      content: [
        { type: "text", text: `ls: cannot access 'jobs/batch-${i}': No such file or directory` },
      ],
      isError: true,
      timestamp: Date.now(),
    });
  }
  const closingId = manager.appendMessage(
    assistant([
      {
        type: "text",
        text: "The batch directories are missing, so the job has nothing to process. Let me know what to check next.",
      },
    ]),
  );

  const artifactDir = join(dir, "artifacts");
  await mkdir(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, `${maskedId}.txt`);
  await writeFile(artifactPath, probe.maskedText, { mode: 0o600 });
  const text = placeholder(
    { entryId: maskedId, toolName: probe.tool, text: probe.maskedText },
    artifactPath,
  );
  manager.appendContextEdit(maskedId, { content: [{ type: "text", text }] });
  manager.appendCustomEntry("context-masking", {
    items: [{ entryId: maskedId, toolName: probe.tool, path: artifactPath }],
  });
  if (probe.compacted) {
    manager.appendCompaction(
      "The user asked why the nightly migration job is slow. The batch directories under jobs/ were missing, so the job had nothing to process.",
      closingId,
      60_000,
    );
  }

  const header = manager.getHeader();
  const sessionFile = join(dir, "session.jsonl");
  await writeFile(
    sessionFile,
    `${[header, ...manager.getEntries()].map((e) => JSON.stringify(e)).join("\n")}\n`,
  );
  return { sessionFile, artifactPath, cwd };
}

export interface ProbeOutcome {
  recalledArtifact: boolean;
  reranOriginal: boolean;
  toolCalls: number;
  correct: boolean;
}

/** Scores the entries Pi appended after the probe question. */
export function scoreRun(
  entries: readonly unknown[],
  probe: ProbeCase,
  artifactPath: string,
): ProbeOutcome {
  const original = probe.tool === "bash" ? probe.args.command : probe.args.path;
  let recalledArtifact = false;
  let reranOriginal = false;
  let toolCalls = 0;
  let finalText = "";
  for (const entry of entries) {
    const message = (entry as { type?: string; message?: { role?: string; content?: unknown } })
      .message;
    if (
      (entry as { type?: string }).type !== "message" ||
      message?.role !== "assistant" ||
      !Array.isArray(message.content)
    )
      continue;
    for (const block of message.content as { type: string; text?: string; arguments?: unknown }[]) {
      if (block.type === "toolCall") {
        toolCalls++;
        // Codemode scripts carry nested calls inside their source, so match on arguments.
        const args = JSON.stringify(block.arguments ?? {});
        if (args.includes(artifactPath)) recalledArtifact = true;
        else if (original !== undefined && args.includes(original)) reranOriginal = true;
      } else if (block.type === "text" && block.text) {
        finalText = block.text;
      }
    }
  }
  return { recalledArtifact, reranOriginal, toolCalls, correct: finalText.includes(probe.answer) };
}

function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    // The Pi sandbox launcher refuses to start while GitHub token variables are set.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !/^(GH|GITHUB)_(TOKEN|PAT|ENTERPRISE_TOKEN)$/u.test(name),
      ),
    );
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr: stderr.slice(-2000) });
    });
  });
}

async function probeOnce(
  probe: ProbeCase,
  model: string,
  dir: string,
  extraArgs: readonly string[] = [],
) {
  const { sessionFile, artifactPath, cwd } = await buildSession(probe, dir);
  const before = (await readFile(sessionFile, "utf8")).trim().split("\n").length;
  const result = await run(
    PI_BIN,
    ["-p", ...extraArgs, "--session", sessionFile, "--model", model, probe.question],
    cwd,
    600_000,
  );
  const lines = (await readFile(sessionFile, "utf8")).trim().split("\n");
  const appended = lines.slice(before).flatMap((line) => {
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      return [];
    }
  });
  return {
    exit: result.code,
    stderr: result.code === 0 ? "" : result.stderr,
    ...scoreRun(appended, probe, artifactPath),
  };
}

async function main(): Promise<void> {
  const [models = "openai-codex/gpt-6-luna-fast", repeatsArg = "2"] = process.argv.slice(2);
  const repeats = Number(repeatsArg);
  const root = join(tmpdir(), `context-masking-probe-${Date.now()}`);
  // PROBE_ISOLATE=1 runs only the compacted case with every other extension disabled, once with
  // context-masking loaded and once without, so the saved-results index is the only difference.
  const isolate = process.env.PROBE_ISOLATE === "1";
  const maskingDir = join(import.meta.dir, "..", "extensions", "context-masking");
  const arms: { arm: string; args: string[] }[] = isolate
    ? [
        { arm: "index", args: ["-ne", "-e", maskingDir] },
        { arm: "no-index", args: ["-ne"] },
      ]
    : [{ arm: "full", args: [] }];
  const cases = probeCases().filter((probe) => !isolate || probe.compacted);
  const jobs: { model: string; probe: ProbeCase; dir: string; arm: string; args: string[] }[] = [];
  for (const model of models.split(",")) {
    for (let r = 0; r < repeats; r++) {
      for (const probe of cases) {
        for (const { arm, args } of arms) {
          jobs.push({
            model,
            probe,
            arm,
            args,
            dir: join(root, `${model.replace(/\W/gu, "_")}-${probe.name}-${arm}-${r}`),
          });
        }
      }
    }
  }
  const results: Record<string, unknown>[] = [];
  const queue = [...jobs];
  // Bounded concurrency keeps provider rate limits and local Pi startup load reasonable.
  const worker = async (): Promise<void> => {
    for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
      const outcome = await probeOnce(job.probe, job.model, job.dir, job.args);
      results.push({ model: job.model, case: job.probe.name, arm: job.arm, ...outcome });
      console.error(`${job.model} ${job.probe.name} ${job.arm}: ${JSON.stringify(outcome)}`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log(JSON.stringify(results));
  if (process.env.KEEP_PROBE !== "1") await rm(root, { recursive: true, force: true });
  else console.error(`kept ${root}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
