import { tool } from "@opencode-ai/plugin"
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
const libexec = existsSync(join(configLibexec, "gh_pr_feedback_context.ts")) ? configLibexec : dotfilesLibexec

function runCommand(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<CommandResult> {
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

export default tool({
  description: "Fetch GitHub PR review feedback context with unresolved actionable threads",
  args: {
    input: tool.schema
      .string()
      .optional()
      .describe("PR URL, PR number, review/discussion URL, or empty to infer from current branch"),
  },
  async execute(args, context) {
    const script = join(libexec, "gh_pr_feedback_context.ts")
    if (existsSync(script) === false) {
      return "ERROR: Missing gh_pr_feedback_context.ts"
    }

    const result = await runCommand(
      "bun",
      ["--cwd", libexec, script, "all", args.input ?? ""],
      libexec,
      {
        ...process.env,
        OPENCODE_LIBEXEC_CWD: context.directory,
      },
    )

    if (result.exitCode === 0) {
      return result.stdout.trimEnd()
    }

    const output = result.stderr.trim() || result.stdout.trim() || `gh_pr_feedback_context failed with exit ${result.exitCode ?? "unknown"}`
    return output.startsWith("ERROR:") ? output : `ERROR: ${output}`
  },
})
