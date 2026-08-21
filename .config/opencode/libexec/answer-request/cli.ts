#!/usr/bin/env bun

import { runAnswerRequestProcess } from "./cli-runtime.js";

if (import.meta.main) {
  await runAnswerRequestProcess(async () => ({
    ok: false,
    code: "backend_unavailable",
  }));
}
