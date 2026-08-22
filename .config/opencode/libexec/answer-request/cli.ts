#!/usr/bin/env bun

import { createOpenCodeAnswerBackend, runOpenCodePreflight } from "./opencode-backend.js";
import { runAnswerPreflightProcess, runAnswerRequestProcess } from "./cli-runtime.js";

if (import.meta.main) {
  if (process.argv.length === 3 && process.argv[2] === "--preflight") {
    await runAnswerPreflightProcess((signal) => runOpenCodePreflight(undefined, signal));
  } else {
    await runAnswerRequestProcess(createOpenCodeAnswerBackend());
  }
}
