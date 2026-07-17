import { tool } from "@opencode-ai/plugin/tool"
import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

type Provider = "github" | "azure-devops"

type CommandResult = {
  stdout: string
  stderr: string
  exitCode: number | null
}

type RemoteContext = {
  name: string
  url: string
  provider: Provider | null
  owner: string | null
  repo: string | null
  org: string | null
  project: string | null
}

type PrContext = {
  branch: string
  remote: RemoteContext
  upstream: string | null
  ahead: number | null
  behind: number | null
  base: string
  targetBranch: string
  hasUncommittedChanges: boolean
}

function runCommand(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })

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
  if (result.exitCode !== 0) {
    return null
  }

  const value = result.stdout.trim()
  return value === "" ? null : value
}

async function commandExists(command: string, cwd: string): Promise<boolean> {
  const result = await runCommand("sh", ["-c", `command -v ${command} >/dev/null 2>&1`], cwd)
  return result.exitCode === 0
}

function parseRemote(name: string, url: string): RemoteContext {
  const github = parseGitHub(url)
  if (github !== null) {
    return { name, url, provider: "github", ...github, org: null, project: null }
  }

  const azure = parseAzureDevOps(url)
  if (azure !== null) {
    return { name, url, provider: "azure-devops", owner: null, ...azure }
  }

  return { name, url, provider: null, owner: null, repo: null, org: null, project: null }
}

function parseGitHub(value: string): { owner: string; repo: string } | null {
  const patterns = [
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/,
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/,
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/,
  ]

  for (const pattern of patterns) {
    const match = value.match(pattern)
    if (match?.[1] && match[2]) {
      return { owner: match[1], repo: match[2] }
    }
  }

  return null
}

function parseAzureDevOps(value: string): { org: string; project: string; repo: string } | null {
  const devAzureSsh = value.match(/^[^@]+@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)$/)
  if (devAzureSsh?.[1] && devAzureSsh[2] && devAzureSsh[3]) {
    return {
      org: `https://dev.azure.com/${devAzureSsh[1]}`,
      project: decodeSegment(devAzureSsh[2]),
      repo: stripGitSuffix(decodeSegment(devAzureSsh[3])),
    }
  }

  const visualStudioSsh = value.match(/^[^@]+@vs-ssh\.visualstudio\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)$/)
  if (visualStudioSsh?.[1] && visualStudioSsh[2] && visualStudioSsh[3]) {
    return {
      org: `https://${visualStudioSsh[1]}.visualstudio.com`,
      project: decodeSegment(visualStudioSsh[2]),
      repo: stripGitSuffix(decodeSegment(visualStudioSsh[3])),
    }
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }

  const segments = parsed.pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(decodeSegment)
  const host = parsed.hostname.toLowerCase()

  if (host.endsWith("dev.azure.com") && segments.length >= 4 && segments[2] === "_git") {
    return {
      org: `https://dev.azure.com/${segments[0]}`,
      project: segments[1],
      repo: stripGitSuffix(segments[3]),
    }
  }

  if (host.endsWith("visualstudio.com") && segments.length >= 3 && segments[1] === "_git") {
    return {
      org: `${parsed.protocol}//${parsed.host}`,
      project: segments[0],
      repo: stripGitSuffix(segments[2]),
    }
  }

  return null
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function stripGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value
}

async function detectBaseBranch(branch: string, remote: string, cwd: string): Promise<string | null> {
  if (branch === "main" || branch === "master") {
    const upstream = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd)
    if (upstream !== null) {
      return upstream
    }
  }

  const remoteHead = await git(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`], cwd)
  if (remoteHead !== null && (remoteHead === `${remote}/main` || remoteHead === `${remote}/master`)) {
    return remoteHead
  }

  for (const ref of [
    `${remote}/main`,
    `${remote}/master`,
    "origin/main",
    "origin/master",
    "main",
    "master",
  ]) {
    const result = await runCommand("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd)
    if (result.exitCode === 0) {
      return ref
    }
  }

  return null
}

function normalizeBaseForProvider(base: string, remote: string): string {
  const remoteRefPrefix = `refs/remotes/${remote}/`
  if (base.startsWith(remoteRefPrefix)) {
    return base.slice(remoteRefPrefix.length)
  }

  const headRefPrefix = "refs/heads/"
  if (base.startsWith(headRefPrefix)) {
    return base.slice(headRefPrefix.length)
  }

  const remotePrefix = `${remote}/`
  if (base.startsWith(remotePrefix)) {
    return base.slice(remotePrefix.length)
  }

  return base
}

async function resolveTargetBranch(targetBranch: string, remote: string, cwd: string): Promise<{ base: string; targetBranch: string } | null> {
  const normalizedTargetBranch = normalizeBaseForProvider(targetBranch, remote)
  const candidates = [
    `refs/remotes/${remote}/${normalizedTargetBranch}`,
    `${remote}/${normalizedTargetBranch}`,
    `refs/heads/${normalizedTargetBranch}`,
    normalizedTargetBranch,
    targetBranch,
  ]

  for (const ref of candidates) {
    const result = await runCommand("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd)
    if (result.exitCode === 0) {
      return { base: ref, targetBranch: normalizedTargetBranch }
    }
  }

  return null
}

function toHeadRef(branch: string): string {
  return branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`
}

function extractAzureWorkItemIds(value: string): string[] {
  const ids = new Set<string>()
  for (const match of value.matchAll(/\bAB#(\d+)\b/giu)) {
    if (match[1] !== undefined) {
      ids.add(match[1])
    }
  }

  return [...ids]
}

async function detectAzureWorkItems(context: PrContext, title: string, body: string, cwd: string): Promise<string[]> {
  const values = [context.branch, title, body]
  const mergeBase = await git(["merge-base", "HEAD", context.base], cwd)
  if (mergeBase !== null) {
    const commitMessages = await git(["log", "--format=%B", `${mergeBase}..HEAD`], cwd)
    if (commitMessages !== null) {
      values.push(commitMessages)
    }
  }

  return extractAzureWorkItemIds(values.join("\n"))
}

async function getRemotes(cwd: string): Promise<RemoteContext[]> {
  const names = await git(["remote"], cwd)
  if (names === null) {
    return []
  }

  const remotes: RemoteContext[] = []
  for (const name of names
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)) {
    const url = await git(["remote", "get-url", name], cwd)
    if (url !== null) {
      remotes.push(parseRemote(name, url))
    }
  }

  return remotes
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

async function selectRemote(remotes: RemoteContext[], cwd: string): Promise<RemoteContext | null> {
  const trackedRemote = (await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd))?.split("/")[0]

  return (
    remotes.find((remote) => remote.name === trackedRemote && remote.provider !== null) ??
    remotes.find((remote) => remote.name === "origin" && remote.provider !== null) ??
    remotes.find((remote) => remote.provider !== null) ??
    null
  )
}

async function detectContext(cwd: string, targetBranchArg?: string): Promise<{ context?: PrContext; error?: string }> {
  const insideWorkTree = await git(["rev-parse", "--is-inside-work-tree"], cwd)
  if (insideWorkTree !== "true") {
    return { error: "ERROR: Not inside a git worktree." }
  }

  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)
  if (branch === null || branch === "HEAD") {
    return { error: "ERROR: Current checkout is detached or branch cannot be determined." }
  }

  const remotes = await getRemotes(cwd)
  const remote = await selectRemote(remotes, cwd)
  if (remote === null || remote.provider === null) {
    return { error: "ERROR: Could not detect GitHub or Azure DevOps from git remotes." }
  }

  const requestedTargetBranch = targetBranchArg?.trim()
  const hasTargetBranch = requestedTargetBranch !== undefined && requestedTargetBranch.length > 0

  let base: string | null
  let targetBranch = ""

  if (hasTargetBranch === false) {
    base = await detectBaseBranch(branch, remote.name, cwd)
    if (base !== null) {
      targetBranch = normalizeBaseForProvider(base, remote.name)
    }
  } else {
    const resolvedTarget = await resolveTargetBranch(requestedTargetBranch, remote.name, cwd)
    base = resolvedTarget?.base ?? null
    targetBranch = resolvedTarget?.targetBranch ?? requestedTargetBranch
  }

  if (base === null) {
    return { error: "ERROR: Cannot open PR: unable to determine base branch." }
  }

  const upstream = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd)
  const aheadText = upstream === null ? null : await git(["rev-list", "--count", `${upstream}..HEAD`], cwd)
  const behindText = upstream === null ? null : await git(["rev-list", "--count", `HEAD..${upstream}`], cwd)
  const unstaged = await runCommand("git", ["diff", "--quiet"], cwd)
  const staged = await runCommand("git", ["diff", "--cached", "--quiet"], cwd)

  return {
    context: {
      branch,
      remote,
      upstream,
      ahead: aheadText === null ? null : Number.parseInt(aheadText, 10),
      behind: behindText === null ? null : Number.parseInt(behindText, 10),
      base,
      targetBranch,
      hasUncommittedChanges: unstaged.exitCode !== 0 || staged.exitCode !== 0,
    },
  }
}

async function pushBranch(context: PrContext, cwd: string): Promise<string | null> {
  if (context.behind !== null && context.behind > 0) {
    return "ERROR: Cannot open PR: current branch is behind its upstream."
  }

  if (context.upstream === null) {
    const result = await runCommand("git", ["push", "-u", context.remote.name, context.branch], cwd)
    return result.exitCode === 0 ? null : formatCommandError("git push", result)
  }

  if (context.ahead !== null && context.ahead > 0) {
    const result = await runCommand("git", ["push"], cwd)
    return result.exitCode === 0 ? null : formatCommandError("git push", result)
  }

  return null
}

async function openPullRequest(context: PrContext, title: string, body: string, cwd: string): Promise<string> {
  const missingCli = context.remote.provider === "github" ? "gh" : "az"
  if ((await commandExists(missingCli, cwd)) === false) {
    return `ERROR: Cannot open PR: ${missingCli} is not available.`
  }

  const pushError = await pushBranch(context, cwd)
  if (pushError !== null) {
    return pushError
  }

  const tempDir = await mkdtemp(join(tmpdir(), "opencode-open-pr-"))
  const bodyFile = join(tempDir, "body.md")

  try {
    await writeFile(bodyFile, body, "utf8")

    if (context.remote.provider === "github") {
      const repo = `${context.remote.owner}/${context.remote.repo}`
      const result = await runCommand(
        "gh",
        ["pr", "create", "--repo", repo, "--base", context.targetBranch, "--head", context.branch, "--title", title, "--body-file", bodyFile],
        cwd,
      )
      return result.exitCode === 0 ? result.stdout.trimEnd() : formatCommandError("gh pr create", result)
    }

    const workItems = await detectAzureWorkItems(context, title, body, cwd)
    const args = [
      "repos",
      "pr",
      "create",
      "--org",
      context.remote.org ?? "",
      "--project",
      context.remote.project ?? "",
      "--repository",
      context.remote.repo ?? "",
      "--source-branch",
      toHeadRef(context.branch),
      "--target-branch",
      toHeadRef(context.targetBranch),
      "--title",
      title,
      "--description",
      `@${bodyFile}`,
      "--output",
      "json",
    ]

    if (workItems.length > 0) {
      args.push("--work-items", ...workItems)
    }

    const result = await runCommand(
      "az",
      args,
      cwd,
      {
        ...process.env,
        AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "yes_without_prompt",
      },
    )

    if (result.exitCode !== 0) {
      return formatCommandError("az repos pr create", result)
    }

    return extractAzureUrl(result.stdout, context) ?? result.stdout.trimEnd()
  } finally {
    await rm(tempDir, { force: true, recursive: true })
  }
}

async function requestCodexReview(context: PrContext, prUrl: string, cwd: string): Promise<string | null> {
  if (context.remote.provider !== "github") {
    return "ERROR: Cannot request Codex review: it is only supported for GitHub pull requests."
  }

  const repo = `${context.remote.owner}/${context.remote.repo}`
  const result = await runCommand("gh", ["pr", "comment", prUrl, "--repo", repo, "--body", "@codex review"], cwd)
  return result.exitCode === 0 ? null : formatCommandError("gh pr comment", result)
}

function pathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "%20")
}

function extractAzureUrl(value: string, context: PrContext): string | null {
  try {
    const parsed = JSON.parse(value) as { pullRequestId?: unknown; url?: unknown; remoteUrl?: unknown }
    if (typeof parsed.pullRequestId === "number" && context.remote.org !== null && context.remote.project !== null && context.remote.repo !== null) {
      return `${context.remote.org}/${pathSegment(context.remote.project)}/_git/${pathSegment(context.remote.repo)}/pullrequest/${parsed.pullRequestId}`
    }

    if (typeof parsed.remoteUrl === "string" && parsed.remoteUrl.includes("/_git/") && !parsed.remoteUrl.includes("/_apis/")) {
      return parsed.remoteUrl
    }

    if (typeof parsed.url === "string" && !parsed.url.includes("/_apis/")) {
      return parsed.url
    }
  } catch {
    return null
  }

  return null
}

function formatCommandError(command: string, result: CommandResult): string {
  const output = result.stderr.trim() || result.stdout.trim() || `${command} failed with exit ${result.exitCode ?? "unknown"}`
  return output.startsWith("ERROR:") ? output : `ERROR: ${output}`
}

function formatContext(context: PrContext): string {
  const lines = [
    `Provider: ${context.remote.provider}`,
    `Remote: ${context.remote.name}`,
    `Remote URL: ${context.remote.url}`,
    `Branch: ${context.branch}`,
    `Upstream: ${context.upstream ?? "(none)"}`,
    `Ahead: ${context.ahead ?? "(unknown)"}`,
    `Behind: ${context.behind ?? "(unknown)"}`,
    `Base: ${context.base}`,
    `Target branch: ${context.targetBranch}`,
    `Uncommitted changes: ${context.hasUncommittedChanges ? "yes" : "no"}`,
  ]

  if (context.remote.provider === "github") {
    lines.push(`GitHub repository: ${context.remote.owner}/${context.remote.repo}`)
  } else {
    lines.push(`Azure org: ${context.remote.org}`)
    lines.push(`Azure project: ${context.remote.project}`)
    lines.push(`Azure repository: ${context.remote.repo}`)
  }

  return lines.join("\n")
}

export default tool({
  description: "Open a pull request for the current branch on GitHub or Azure DevOps",
  args: {
    title: tool.schema.string().optional().describe("PR title. If omitted, return detected PR context only."),
    body: tool.schema.string().optional().describe("Markdown PR body. Required when title is provided."),
    targetBranch: tool.schema.string().optional().describe("Optional PR target branch. Defaults to the repository's main branch."),
    argument1: tool.schema.string().optional().describe("Optional slash-command target branch argument."),
    requestCodexReview: tool.schema.boolean().optional().describe("Post '@codex review' on the new GitHub pull request."),
  },
  async execute(args, context) {
    const targetBranch = optionalString(args.targetBranch as string | undefined) ?? optionalString(args.argument1 as string | undefined)

    const detected = await detectContext(context.directory, targetBranch)
    if (detected.error !== undefined) {
      return detected.error
    }

    const prContext = detected.context
    if (prContext === undefined) {
      return "ERROR: Failed to detect pull request context."
    }

    if (args.title === undefined && args.body === undefined) {
      return formatContext(prContext)
    }

    if (args.title === undefined || args.body === undefined) {
      return "ERROR: Both title and body are required to open a PR."
    }

    if (args.requestCodexReview === true && prContext.remote.provider !== "github") {
      return "ERROR: Cannot request Codex review: it is only supported for GitHub pull requests."
    }

    const prUrl = await openPullRequest(prContext, args.title, args.body, context.directory)
    if (prUrl.startsWith("ERROR:")) {
      return prUrl
    }

    if (args.requestCodexReview === true) {
      const reviewError = await requestCodexReview(prContext, prUrl, context.directory)
      if (reviewError !== null) {
        return `${reviewError}\nPR opened: ${prUrl}`
      }
    }

    return prUrl
  },
})
