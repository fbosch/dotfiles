#!/usr/bin/env bun

import { runAnswerRequestProcess } from "./cli-runtime.js";
import { createAnswerFailure } from "./index.js";

if (import.meta.main) {
  await runAnswerRequestProcess(async (request) =>
    createAnswerFailure("backend_unavailable", request.requestId),
  );
}
