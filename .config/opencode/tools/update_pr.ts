import { tool } from "@opencode-ai/plugin/tool"
import { spawn } from "node:child_process"

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

type RepositoryContext = {
  branch: string
  remote: RemoteContext
}

type PullRequestContext = RepositoryContext & {
  id: number
  title: string
  body: string
  sourceBranch: string
  targetBranch: string
  status: string
  url: string
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  input?: string,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    const stdoutStream = child.stdout
    const stderrStream = child.stderr
    if (stdoutStream === null || stderrStream === null) {
      child.kill()
      reject(new Error(`Failed to capture output from ${command}`))
      return
    }

    stdoutStream.setEncoding("utf8")
    stderrStream.setEncoding("utf8")
    stdoutStream.on("data", (chunk: string) => {
      stdout += chunk
    })
    stderrStream.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode })
    })

    if (input !== undefined) {
      const stdinStream = child.stdin
      if (stdinStream === null) {
        child.kill()
        reject(new Error(`Failed to open input for ${command}`))
        return
      }
      stdinStream.end(input)
    }
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
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i,
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i,
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i,
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
  if (devAzureSsh?.[1] && devAzureSsh[2] && devAzureSsh[3] && isAzureOrganizationName(devAzureSsh[1])) {
    return {
      org: `https://dev.azure.com/${devAzureSsh[1]}`,
      project: decodeSegment(devAzureSsh[2]),
      repo: stripGitSuffix(decodeSegment(devAzureSsh[3])),
    }
  }

  const visualStudioSsh = value.match(/^[^@]+@vs-ssh\.visualstudio\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)$/)
  if (visualStudioSsh?.[1] && visualStudioSsh[2] && visualStudioSsh[3] && isAzureOrganizationName(visualStudioSsh[1])) {
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
  if (parsed.protocol !== "https:") {
    return null
  }

  if (host === "dev.azure.com" && segments.length >= 4 && segments[2] === "_git") {
    return {
      org: `https://dev.azure.com/${segments[0]}`,
      project: segments[1],
      repo: stripGitSuffix(segments[3]),
    }
  }

  if (host.endsWith(".visualstudio.com") && segments.length >= 3 && segments[1] === "_git") {
    return {
      org: `${parsed.protocol}//${parsed.host}`,
      project: segments[0],
      repo: stripGitSuffix(segments[2]),
    }
  }

  return null
}

function isAzureOrganizationName(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/i.test(value)
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

function stripHeadRef(value: string): string {
  return value.startsWith("refs/heads/") ? value.slice("refs/heads/".length) : value
}

function pathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "%20")
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

async function selectRemote(remotes: RemoteContext[], cwd: string): Promise<RemoteContext | null> {
  const trackedRemote = (await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd))?.split("/")[0]

  return (
    remotes.find((remote) => remote.name === trackedRemote && remote.provider !== null) ??
    remotes.find((remote) => remote.name === "origin" && remote.provider !== null) ??
    remotes.find((remote) => remote.provider !== null) ??
    null
  )
}

async function detectRepository(cwd: string): Promise<{ context?: RepositoryContext; error?: string }> {
  const insideWorkTree = await git(["rev-parse", "--is-inside-work-tree"], cwd)
  if (insideWorkTree !== "true") {
    return { error: "ERROR: Not inside a git worktree." }
  }

  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)
  if (branch === null || branch === "HEAD") {
    return { error: "ERROR: Current checkout is detached or branch cannot be determined." }
  }

  const remote = await selectRemote(await getRemotes(cwd), cwd)
  if (remote === null || remote.provider === null) {
    return { error: "ERROR: Could not detect GitHub or Azure DevOps from git remotes." }
  }

  return { context: { branch, remote } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

async function findGitHubPullRequest(context: RepositoryContext, cwd: string): Promise<{ context?: PullRequestContext; error?: string }> {
  const result = await runCommand(
    "gh",
    ["pr", "view", "--json", "number,title,body,url,baseRefName,headRefName,state"],
    cwd,
  )
  if (result.exitCode !== 0) {
    return { error: formatCommandError("gh pr view", result) }
  }

  const value = parseJson(result.stdout)
  if (
    isRecord(value) === false ||
    typeof value.number !== "number" ||
    typeof value.title !== "string" ||
    typeof value.body !== "string" ||
    typeof value.url !== "string" ||
    typeof value.baseRefName !== "string" ||
    typeof value.headRefName !== "string" ||
    typeof value.state !== "string"
  ) {
    return { error: "ERROR: Could not parse GitHub pull request details." }
  }

  if (value.state !== "OPEN") {
    return { error: `ERROR: Pull request #${value.number} is ${value.state.toLowerCase()}, not open.` }
  }

  return {
    context: {
      ...context,
      id: value.number,
      title: value.title,
      body: value.body,
      sourceBranch: value.headRefName,
      targetBranch: value.baseRefName,
      status: value.state,
      url: value.url,
    },
  }
}

function nestedString(value: Record<string, unknown>, keys: string[]): string | null {
  let current: unknown = value
  for (const key of keys) {
    if (isRecord(current) === false) {
      return null
    }
    current = current[key]
  }

  return typeof current === "string" ? current : null
}

function azurePullRequestUrl(context: RepositoryContext, id: number, value: Record<string, unknown>): string | null {
  const webUrl = nestedString(value, ["_links", "web", "href"])
  if (webUrl !== null) {
    return webUrl
  }

  if (context.remote.org === null || context.remote.project === null || context.remote.repo === null) {
    return null
  }

  return `${context.remote.org}/${pathSegment(context.remote.project)}/_git/${pathSegment(context.remote.repo)}/pullrequest/${id}`
}

async function findAzurePullRequest(context: RepositoryContext, cwd: string): Promise<{ context?: PullRequestContext; error?: string }> {
  const result = await runCommand(
    "az",
    [
      "repos",
      "pr",
      "list",
      "--org",
      context.remote.org ?? "",
      "--project",
      context.remote.project ?? "",
      "--repository",
      context.remote.repo ?? "",
      "--source-branch",
      context.branch,
      "--status",
      "active",
      "--include-links",
      "--top",
      "2",
      "--output",
      "json",
    ],
    cwd,
    {
      ...process.env,
      AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "no",
    },
  )
  if (result.exitCode !== 0) {
    return { error: formatCommandError("az repos pr list", result) }
  }

  const values = parseJson(result.stdout)
  if (Array.isArray(values) === false) {
    return { error: "ERROR: Could not parse Azure DevOps pull request details." }
  }
  if (values.length === 0) {
    return { error: `ERROR: No active pull request found for branch ${context.branch}.` }
  }
  if (values.length > 1) {
    return { error: `ERROR: Multiple active pull requests found for branch ${context.branch}.` }
  }

  const value: unknown = values[0]
  if (
    isRecord(value) === false ||
    typeof value.pullRequestId !== "number" ||
    typeof value.title !== "string" ||
    (typeof value.description !== "string" && value.description !== null) ||
    typeof value.sourceRefName !== "string" ||
    typeof value.targetRefName !== "string" ||
    typeof value.status !== "string"
  ) {
    return { error: "ERROR: Could not parse Azure DevOps pull request details." }
  }

  const url = azurePullRequestUrl(context, value.pullRequestId, value)
  if (url === null) {
    return { error: "ERROR: Could not determine Azure DevOps pull request URL." }
  }

  return {
    context: {
      ...context,
      id: value.pullRequestId,
      title: value.title,
      body: value.description ?? "",
      sourceBranch: stripHeadRef(value.sourceRefName),
      targetBranch: stripHeadRef(value.targetRefName),
      status: value.status,
      url,
    },
  }
}

async function findPullRequest(context: RepositoryContext, cwd: string): Promise<{ context?: PullRequestContext; error?: string }> {
  const cli = context.remote.provider === "github" ? "gh" : "az"
  if ((await commandExists(cli, cwd)) === false) {
    return { error: `ERROR: Cannot update PR: ${cli} is not available.` }
  }

  return context.remote.provider === "github" ? findGitHubPullRequest(context, cwd) : findAzurePullRequest(context, cwd)
}

async function updatePullRequest(context: PullRequestContext, title: string | undefined, body: string | undefined, cwd: string): Promise<string> {
  if (context.remote.provider === "github") {
    const args = ["pr", "edit", context.url]
    if (title !== undefined) {
      args.push(`--title=${title}`)
    }
    if (body !== undefined) {
      args.push("--body-file=-")
    }

    const result = await runCommand("gh", args, cwd, process.env, body)
    return result.exitCode === 0 ? context.url : formatCommandError("gh pr edit", result)
  }

  const args = [
    "repos",
    "pr",
    "update",
    "--id",
    String(context.id),
    "--org",
    context.remote.org ?? "",
    "--output",
    "json",
  ]
  if (title !== undefined) {
    args.push(`--title=${title}`)
  }
  if (body !== undefined) {
    args.push(`--description=${body}`)
  }

  const result = await runCommand("az", args, cwd, {
    ...process.env,
    AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "no",
  })
  return result.exitCode === 0 ? context.url : formatCommandError("az repos pr update", result)
}

function formatCommandError(command: string, result: CommandResult): string {
  const output = result.stderr.trim() || result.stdout.trim() || `${command} failed with exit ${result.exitCode ?? "unknown"}`
  return output.startsWith("ERROR:") ? output : `ERROR: ${output}`
}

function formatContext(context: PullRequestContext): string {
  const lines = [
    `Provider: ${context.remote.provider}`,
    `Remote: ${context.remote.name}`,
    `Branch: ${context.branch}`,
    `Pull request: ${context.id}`,
    `URL: ${context.url}`,
    `Status: ${context.status}`,
    `Source branch: ${context.sourceBranch}`,
    `Target branch: ${context.targetBranch}`,
    `Title: ${context.title}`,
  ]

  if (context.remote.provider === "azure-devops") {
    lines.push(`Azure org: ${context.remote.org}`)
    lines.push(`Azure project: ${context.remote.project}`)
    lines.push(`Azure repository: ${context.remote.repo}`)
  }

  return lines.join("\n")
}

export default tool({
  description: "Update the active pull request for the current branch on GitHub or Azure DevOps",
  args: {
    title: tool.schema.string().optional().describe("Optional replacement PR title."),
    body: tool.schema.string().optional().describe("Optional replacement Markdown PR body. An empty string clears the body."),
  },
  async execute(args, context) {
    const title = args.title?.trim()
    if (args.title !== undefined && title?.length === 0) {
      return "ERROR: PR title cannot be empty."
    }

    const detected = await detectRepository(context.directory)
    if (detected.error !== undefined) {
      return detected.error
    }

    const repository = detected.context
    if (repository === undefined) {
      return "ERROR: Failed to detect pull request repository context."
    }

    const found = await findPullRequest(repository, context.directory)
    if (found.error !== undefined) {
      return found.error
    }

    const pullRequest = found.context
    if (pullRequest === undefined) {
      return "ERROR: Failed to detect pull request context."
    }

    if (args.title === undefined && args.body === undefined) {
      return formatContext(pullRequest)
    }

    return updatePullRequest(pullRequest, title, args.body, context.directory)
  },
})
