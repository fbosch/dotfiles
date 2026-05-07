import { tool } from "@opencode-ai/plugin/tool"
import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

type Provider = "github" | "azure-devops"
type ProviderArg = Provider | "gh" | "az"

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
  if (remoteHead !== null) {
    return remoteHead
  }

  for (const ref of [
    `${remote}/main`,
    `${remote}/master`,
    `${remote}/develop`,
    `${remote}/dev`,
    `${remote}/trunk`,
    "origin/main",
    "origin/master",
    "origin/develop",
    "origin/dev",
    "origin/trunk",
    "main",
    "master",
    "develop",
    "dev",
    "trunk",
  ]) {
    const result = await runCommand("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd)
    if (result.exitCode === 0) {
      return ref
    }
  }

  return null
}

function normalizeBaseForProvider(base: string): string {
  const slashIndex = base.indexOf("/")
  return slashIndex === -1 ? base : base.slice(slashIndex + 1)
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

function normalizeProvider(value: ProviderArg): Provider {
  return value === "gh" ? "github" : value === "az" ? "azure-devops" : value
}

async function selectRemote(remotes: RemoteContext[], cwd: string, provider?: Provider): Promise<RemoteContext | null> {
  if (provider !== undefined) {
    return remotes.find((remote) => remote.provider === provider) ?? null
  }

  const trackedRemote = (await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd))?.split("/")[0]

  return (
    remotes.find((remote) => remote.name === trackedRemote && remote.provider !== null) ??
    remotes.find((remote) => remote.name === "origin" && remote.provider !== null) ??
    remotes.find((remote) => remote.provider !== null) ??
    null
  )
}

async function detectContext(cwd: string, providerArg?: ProviderArg): Promise<{ context?: PrContext; error?: string }> {
  const insideWorkTree = await git(["rev-parse", "--is-inside-work-tree"], cwd)
  if (insideWorkTree !== "true") {
    return { error: "ERROR: Not inside a git worktree." }
  }

  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)
  if (branch === null || branch === "HEAD") {
    return { error: "ERROR: Current checkout is detached or branch cannot be determined." }
  }

  const remotes = await getRemotes(cwd)
  const provider = providerArg === undefined ? undefined : normalizeProvider(providerArg)
  const remote = await selectRemote(remotes, cwd, provider)
  if (remote === null || remote.provider === null) {
    if (provider !== undefined) {
      return { error: `ERROR: Could not detect ${provider} from git remotes.` }
    }

    return { error: "ERROR: Could not detect GitHub or Azure DevOps from git remotes." }
  }

  const base = await detectBaseBranch(branch, remote.name, cwd)
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
      targetBranch: normalizeBaseForProvider(base),
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

    const result = await runCommand(
      "az",
      [
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
        context.branch,
        "--target-branch",
        context.targetBranch,
        "--title",
        title,
        "--description",
        `@${bodyFile}`,
        "--output",
        "json",
      ],
      cwd,
      {
        ...process.env,
        AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "yes_without_prompt",
      },
    )

    if (result.exitCode !== 0) {
      return formatCommandError("az repos pr create", result)
    }

    return extractAzureUrl(result.stdout) ?? result.stdout.trimEnd()
  } finally {
    await rm(tempDir, { force: true, recursive: true })
  }
}

function extractAzureUrl(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as { url?: unknown; remoteUrl?: unknown }
    if (typeof parsed.url === "string") {
      return parsed.url
    }
    if (typeof parsed.remoteUrl === "string") {
      return parsed.remoteUrl
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
    provider: tool.schema.string().optional().describe("Optional provider override: gh, github, az, or azure-devops."),
  },
  async execute(args, context) {
    const provider = args.provider as string | undefined
    if (
      provider !== undefined &&
      provider !== "gh" &&
      provider !== "github" &&
      provider !== "az" &&
      provider !== "azure-devops"
    ) {
      return "ERROR: provider must be one of: gh, github, az, azure-devops."
    }

    const detected = await detectContext(context.directory, provider as ProviderArg | undefined)
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

    return openPullRequest(prContext, args.title, args.body, context.directory)
  },
})
