import { existsSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

export type DirenvEnvironment = Record<string, string | null>

type DirenvLoadResult =
  | { status: "missing" | "unavailable" }
  | { status: "blocked" }
  | { status: "loaded"; environment: DirenvEnvironment }

type ExportDirenv = (directory: string) => Promise<string>

const isWithin = (directory: string, boundary: string) => {
  const path = relative(boundary, directory)
  return path === "" || (path.startsWith("..") === false && path.startsWith("/") === false)
}

const findEnvrcDirectory = (directory: string, projectDirectory: string) => {
  const start = resolve(directory)
  const project = resolve(projectDirectory)
  const boundary = isWithin(start, project) ? project : start
  let current = start

  while (true) {
    if (existsSync(join(current, ".envrc"))) return current
    if (current === boundary) return
    current = dirname(current)
  }
}

const isBlocked = (error: unknown) => {
  if (typeof error !== "object" || error === null || "stderr" in error === false) return false
  const { stderr } = error as { stderr?: unknown }
  return typeof stderr === "string" && stderr.includes("is blocked")
}

const parseEnvironment = (output: string): DirenvEnvironment | undefined => {
  try {
    const parsed: unknown = JSON.parse(output)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return

    const environment: DirenvEnvironment = Object.create(null)
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value === "string" || value === null) environment[name] = value
    }
    return environment
  } catch {
    return
  }
}

export const loadDirenvEnvironment = async (
  directory: string,
  projectDirectory: string,
  exportDirenv: ExportDirenv,
): Promise<DirenvLoadResult> => {
  const envrcDirectory = findEnvrcDirectory(directory, projectDirectory)
  if (!envrcDirectory) return { status: "missing" }

  try {
    const environment = parseEnvironment(await exportDirenv(envrcDirectory))
    return environment ? { status: "loaded", environment } : { status: "unavailable" }
  } catch (error) {
    return isBlocked(error) ? { status: "blocked" } : { status: "unavailable" }
  }
}
