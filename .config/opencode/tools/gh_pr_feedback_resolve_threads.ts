import { tool } from "@opencode-ai/plugin/tool"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

type CommandResult = {
  stdout: string
  stderr: string
  exitCode: number | null
}

const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
const configLibexec = join(configHome, "opencode", "libexec")
const dotfilesLibexec = join(homedir(), "dotfiles", ".config", "opencode", "libexec")
const libexec = existsSync(join(configLibexec, "gh_pr_feedback_resolve_threads.ts")) ? configLibexec : dotfilesLibexec

function runCommand(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, input: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
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

    child.stdin.end(input)
  })
}

export default tool({
  description: "Comment on and resolve GitHub PR review threads",
  args: {
    threads: tool.schema
      .array(
        tool.schema.object({
          threadId: tool.schema.string().describe("GitHub PullRequestReviewThread node ID"),
          body: tool.schema.string().describe("Resolution comment to post before resolving the thread"),
        }),
      )
      .describe("Review threads to comment on and resolve"),
  },
  async execute(args, context) {
    const script = join(libexec, "gh_pr_feedback_resolve_threads.ts")
    if (existsSync(script) === false) {
      return "ERROR: Missing gh_pr_feedback_resolve_threads.ts"
    }

    const result = await runCommand(
      "bun",
      ["--cwd", libexec, script],
      libexec,
      {
        ...process.env,
        OPENCODE_LIBEXEC_CWD: context.directory,
      },
      JSON.stringify({ threads: args.threads }),
    )

    if (result.exitCode === 0) {
      return result.stdout.trimEnd()
    }

    const output = result.stderr.trim() || result.stdout.trim() || `gh_pr_feedback_resolve_threads failed with exit ${result.exitCode ?? "unknown"}`
    return output.startsWith("ERROR:") ? output : `ERROR: ${output}`
  },
})
