import { appendFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LOG_FILE = join(homedir(), ".opencode-openmemory.log");

let sessionStarted = false;

export function log(message: string, data?: unknown) {
  if (sessionStarted === false) {
    writeFileSync(LOG_FILE, `\n--- Session started: ${new Date().toISOString()} ---\n`, { flag: "a" });
    sessionStarted = true;
  }
  const timestamp = new Date().toISOString();
  const line = data 
    ? `[${timestamp}] ${message}: ${JSON.stringify(data)}\n`
    : `[${timestamp}] ${message}\n`;
  appendFileSync(LOG_FILE, line);
}
