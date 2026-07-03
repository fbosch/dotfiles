import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { EvidenceRecord } from "./types"

function defaultEvidenceRoot(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR || "/tmp"
  return join(runtimeDir, "hypr-computer-use", "evidence")
}

export function evidenceDirectory(explicitDirectory?: string): string {
  return explicitDirectory || defaultEvidenceRoot()
}

export async function writeEvidence(record: EvidenceRecord, explicitDirectory?: string): Promise<string> {
  const directory = evidenceDirectory(explicitDirectory)
  await mkdir(directory, { recursive: true })
  const filename = `${record.timestamp.replace(/[:.]/g, "-")}-${record.operation}.json`
  const path = join(directory, filename)
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8")
  return path
}
