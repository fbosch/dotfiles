#!/usr/bin/env bun

import { createOpenCodeAnswerBackend } from "./opencode-backend.js";
import { runAnswerRequestProcess } from "./cli-runtime.js";

if (import.meta.main) {
  await runAnswerRequestProcess(createOpenCodeAnswerBackend());
}
