import { tool } from "@opencode-ai/plugin/tool"
import { spawn } from "node:child_process"

type Provider = "github" | "azure-devops"

type CommandResult = {
  stdout: string
  stderr: string
  exitCode: number | null
}

type Remote = {
  provider: Provider
  name: string
  owner?: string
  repo: string
  org?: string
  project?: string
}

type Check = {
  name: string
  state: string
  bucket: string
  link?: string
  description?: string
}

const logLimit = 4_000

function runCommand(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode })
    })
  })
}

async function git(args: string[], cwd: string): Promise<string | null> {
  const result = await runCommand("git", args, cwd)
  const value = result.stdout.trim()
  return result.exitCode === 0 && value.length > 0 ? value : null
}

async function commandExists(command: string, cwd: string): Promise<boolean> {
  return (await runCommand("sh", ["-c", `command -v ${command} >/dev/null 2>&1`], cwd)).exitCode === 0
}

function formatError(command: string, result: CommandResult): string {
  const output = result.stderr.trim() || result.stdout.trim() || `${command} failed with exit ${result.exitCode ?? "unknown"}`
  return `ERROR: ${output}`
}

function parseRemote(name: string, url: string): Remote | null {
  const github = url.match(/^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https?:\/\/github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (github?.[1] !== undefined && github[2] !== undefined) {
    return { provider: "github", name, owner: github[1], repo: github[2] }
  }

  const ssh = url.match(/^[^@]+@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)$/)
  if (ssh?.[1] !== undefined && ssh[2] !== undefined && ssh[3] !== undefined) {
    return { provider: "azure-devops", name, org: `https://dev.azure.com/${ssh[1]}`, project: decodeURIComponent(ssh[2]), repo: stripGitSuffix(decodeURIComponent(ssh[3])) }
  }

  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent)
    if (parsed.hostname.endsWith("dev.azure.com") && segments[2] === "_git" && segments.length >= 4) {
      return { provider: "azure-devops", name, org: `https://dev.azure.com/${segments[0]}`, project: segments[1], repo: stripGitSuffix(segments[3]) }
    }
  } catch {
    return null
  }

  return null
}

function stripGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value
}

async function detectRemote(cwd: string): Promise<Remote | null> {
  const upstream = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd)
  const trackedRemote = upstream?.split("/")[0]
  const names = await git(["remote"], cwd)
  if (names === null) {
    return null
  }

  const remotes: Remote[] = []
  for (const name of names.split("\n").filter(Boolean)) {
    const url = await git(["remote", "get-url", name], cwd)
    if (url === null) {
      continue
    }
    const remote = parseRemote(name, url)
    if (remote !== null) {
      remotes.push(remote)
    }
  }

  return remotes.find((remote) => remote.name === trackedRemote) ?? remotes.find((remote) => remote.name === "origin") ?? remotes[0] ?? null
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function excerpt(value: string): string {
  const trimmed = value.trim()
  return trimmed.length <= logLimit ? trimmed : `${trimmed.slice(0, logLimit)}\n... log truncated`
}

function githubCheck(value: unknown): Check | null {
  if (isRecord(value) === false) {
    return null
  }
  const name = string(value.name)
  const state = string(value.state)
  const bucket = string(value.bucket)
  if (name === undefined || state === undefined || bucket === undefined) {
    return null
  }
  return { name, state, bucket, link: string(value.link), description: string(value.description) }
}

function githubRunId(link: string | undefined): string | null {
  const match = link?.match(/\/actions\/runs\/(\d+)/)
  return match?.[1] ?? null
}

async function githubReport(remote: Remote, cwd: string): Promise<string> {
  if ((await commandExists("gh", cwd)) === false) {
    return "ERROR: Cannot inspect CI: gh is not available."
  }

  const prResult = await runCommand("gh", ["pr", "view", "--json", "number,url,title,state,isDraft,headRefName,baseRefName"], cwd)
  if (prResult.exitCode !== 0) {
    return formatError("gh pr view", prResult)
  }
  const pr = parseJson(prResult.stdout)
  if (isRecord(pr) === false || number(pr.number) === undefined || string(pr.url) === undefined) {
    return "ERROR: Cannot inspect CI: gh pr view returned an invalid PR."
  }

  const repo = `${remote.owner}/${remote.repo}`
  const checksResult = await runCommand("gh", ["pr", "checks", String(pr.number), "--repo", repo, "--json", "name,state,bucket,link,description"], cwd)
  const parsedChecks = parseJson(checksResult.stdout)
  if (Array.isArray(parsedChecks) === false) {
    return checksResult.exitCode === 0 ? "ERROR: Cannot inspect CI: gh pr checks returned invalid data." : formatError("gh pr checks", checksResult)
  }
  const checks = parsedChecks.map(githubCheck).filter((check): check is Check => check !== null)
  const failed = checks.filter((check) => check.bucket === "fail")
  const pending = checks.filter((check) => check.bucket === "pending")
  const passed = checks.filter((check) => check.bucket === "pass")
  const other = checks.length - failed.length - pending.length - passed.length
  const lines = [
    "CI report",
    `Provider: GitHub`,
    `PR: #${pr.number} ${string(pr.title) ?? "(untitled)"}`,
    `URL: ${string(pr.url)}`,
    `Branch: ${string(pr.headRefName) ?? "(unknown)"} -> ${string(pr.baseRefName) ?? "(unknown)"}`,
    `State: ${string(pr.state) ?? "(unknown)"}${pr.isDraft === true ? " (draft)" : ""}`,
    `Summary: ${passed.length} passed, ${failed.length} failed, ${pending.length} pending, ${other} other`,
  ]

  if (failed.length > 0) {
    lines.push("", "Failed checks:")
    for (const check of failed) {
      lines.push(`- ${check.name} [${check.state}]${check.link === undefined ? "" : `\n  ${check.link}`}${check.description === undefined ? "" : `\n  ${check.description}`}`)
      const runId = githubRunId(check.link)
      if (runId === null) {
        continue
      }
      const logs = await runCommand("gh", ["run", "view", runId, "--repo", repo, "--log-failed"], cwd)
      if (logs.exitCode === 0 && logs.stdout.trim().length > 0) {
        lines.push(`  Failed log:\n${excerpt(logs.stdout).split("\n").map((line) => `  ${line}`).join("\n")}`)
      }
    }
  }

  if (pending.length > 0) {
    lines.push("", "Pending checks:")
    for (const check of pending) {
      lines.push(`- ${check.name} [${check.state}]${check.link === undefined ? "" : `\n  ${check.link}`}`)
    }
  }

  if (failed.length === 0 && pending.length === 0) {
    lines.push("", "No failing or pending checks found.")
  }
  return lines.join("\n")
}

function azureResult(value: unknown): string {
  return string(value) ?? "unknown"
}

async function azureTimeline(remote: Remote, runId: number, cwd: string): Promise<string[]> {
  const result = await runCommand(
    "az",
    ["devops", "invoke", "--area", "build", "--resource", "timeline", "--route-parameters", `project=${remote.project}`, `buildId=${runId}`, "--api-version", "7.1", "--org", remote.org ?? "", "--output", "json", "--only-show-errors"],
    cwd,
    { ...process.env, AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "yes_without_prompt" },
  )
  const timeline = parseJson(result.stdout)
  if (result.exitCode !== 0 || isRecord(timeline) === false || Array.isArray(timeline.records) === false) {
    return []
  }

  const failures: string[] = []
  for (const record of timeline.records) {
    if (isRecord(record) === false || azureResult(record.result) !== "failed") {
      continue
    }
    const name = string(record.name) ?? "Unnamed task"
    const issues = Array.isArray(record.issues)
      ? record.issues.filter(isRecord).map((issue) => string(issue.message)).filter((message): message is string => message !== undefined)
      : []
    const log = isRecord(record.log) ? number(record.log.id) : undefined
    const logResult = log === undefined
      ? null
      : await runCommand(
          "az",
          ["devops", "invoke", "--area", "build", "--resource", "logs", "--route-parameters", `project=${remote.project}`, `buildId=${runId}`, `logId=${log}`, "--query-parameters", "startLine=1", "endLine=200", "--api-version", "7.1", "--org", remote.org ?? "", "--output", "json", "--only-show-errors"],
          cwd,
          { ...process.env, AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "yes_without_prompt" },
        )
    const logLines = logResult === null ? null : parseJson(logResult.stdout)
    const logText = Array.isArray(logLines)
      ? logLines.map(string).filter((line): line is string => line !== undefined).join("\n")
      : ""
    const details = [...issues, ...(logText.length > 0 ? [excerpt(logText)] : [])]
    failures.push(`- ${name}${details.length === 0 ? "" : `\n  ${details.join("\n  ")}`}`)
  }
  return failures
}

async function azureReport(remote: Remote, branch: string, cwd: string): Promise<string> {
  if ((await commandExists("az", cwd)) === false) {
    return "ERROR: Cannot inspect CI: az is not available."
  }
  const environment = { ...process.env, AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "yes_without_prompt" }
  const prResult = await runCommand("az", ["repos", "pr", "list", "--org", remote.org ?? "", "--project", remote.project ?? "", "--repository", remote.repo, "--source-branch", branch, "--status", "active", "--top", "50", "--output", "json", "--only-show-errors"], cwd, environment)
  const prs = parseJson(prResult.stdout)
  if (prResult.exitCode !== 0) {
    return formatError("az repos pr list", prResult)
  }
  if (Array.isArray(prs) === false || prs.length === 0) {
    return "ERROR: Cannot inspect CI: no active pull request found for the current branch."
  }
  if (prs.length > 1) {
    return "ERROR: Cannot inspect CI: multiple active pull requests found for the current branch."
  }
  const pr = prs[0]
  if (isRecord(pr) === false || number(pr.pullRequestId) === undefined) {
    return "ERROR: Cannot inspect CI: Azure DevOps returned an invalid pull request."
  }

  const prId = number(pr.pullRequestId)!
  const repositoryId = isRecord(pr.repository) ? string(pr.repository.id) : undefined
  const mergeCommit = isRecord(pr.lastMergeCommit) ? string(pr.lastMergeCommit.commitId) : undefined
  const runsResult = await runCommand("az", ["pipelines", "runs", "list", "--org", remote.org ?? "", "--project", remote.project ?? "", "--branch", `refs/pull/${prId}/merge`, "--reason", "pullRequest", "--query-order", "StartTimeDesc", "--top", "100", "--output", "json", "--only-show-errors"], cwd, environment)
  const runs = parseJson(runsResult.stdout)
  if (runsResult.exitCode !== 0 || Array.isArray(runs) === false) {
    return formatError("az pipelines runs list", runsResult)
  }

  const matchingRuns = runs.filter(isRecord).filter((run) => {
    const runRepositoryId = isRecord(run.repository) ? string(run.repository.id) : undefined
    if (repositoryId !== undefined && runRepositoryId !== repositoryId) {
      return false
    }
    return mergeCommit === undefined || string(run.sourceVersion) === mergeCommit
  })
  const failedRuns = matchingRuns.filter((run) => azureResult(run.result) === "failed" || azureResult(run.result) === "partiallySucceeded")
  const pendingRuns = matchingRuns.filter((run) => ["notStarted", "postponed", "inProgress", "cancelling"].includes(azureResult(run.status)))
  const passedRuns = matchingRuns.filter((run) => azureResult(run.result) === "succeeded")
  const lines = [
    "CI report",
    "Provider: Azure DevOps",
    `PR: #${prId} ${string(pr.title) ?? "(untitled)"}`,
    `URL: ${string(pr.remoteUrl) ?? "(unavailable)"}`,
    `Branch: ${string(pr.sourceRefName) ?? branch} -> ${string(pr.targetRefName) ?? "(unknown)"}`,
    `State: ${string(pr.status) ?? "(unknown)"}${pr.isDraft === true ? " (draft)" : ""}`,
    `Summary: ${passedRuns.length} passed, ${failedRuns.length} failed, ${pendingRuns.length} pending`,
  ]

  if (failedRuns.length > 0) {
    lines.push("", "Failed checks:")
    for (const run of failedRuns) {
      const runId = number(run.id)
      const definition = isRecord(run.definition) ? string(run.definition.name) : undefined
      lines.push(`- ${definition ?? string(run.buildNumber) ?? "Unnamed pipeline"} [${azureResult(run.result)}]${runId === undefined ? "" : ` (run ${runId})`}`)
      if (runId !== undefined) {
        lines.push(...(await azureTimeline(remote, runId, cwd)))
      }
    }
  }
  if (pendingRuns.length > 0) {
    lines.push("", "Pending checks:")
    for (const run of pendingRuns) {
      lines.push(`- ${isRecord(run.definition) ? string(run.definition.name) ?? "Unnamed pipeline" : "Unnamed pipeline"} [${azureResult(run.status)}]`)
    }
  }
  if (failedRuns.length === 0 && pendingRuns.length === 0) {
    lines.push("", "No failing or pending checks found.")
  }
  return lines.join("\n")
}

export default tool({
  description: "Inspect the current pull request's GitHub Actions or Azure DevOps CI failures and pending checks",
  args: {},
  async execute(_args, context) {
    const branch = await git(["branch", "--show-current"], context.directory)
    if (branch === null) {
      return "ERROR: Cannot inspect CI: current branch cannot be determined."
    }
    const remote = await detectRemote(context.directory)
    if (remote === null) {
      return "ERROR: Cannot inspect CI: GitHub or Azure DevOps remote cannot be determined."
    }
    return remote.provider === "github" ? githubReport(remote, context.directory) : azureReport(remote, branch, context.directory)
  },
})
