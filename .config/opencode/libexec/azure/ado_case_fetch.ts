#!/usr/bin/env bun

import { azureEnv, detectOrgFromGitRemote, requireNumericId } from "./context.js";
import { runCommand } from "../shared/process.js";

function main(): void {
    const rawId = process.argv[2] ?? "";
    const parsedId = requireNumericId(rawId, "test case");
    if (parsedId.ok === false) {
        console.log(`ERROR: ${parsedId.error}`);
        process.exit(1);
        return;
    }

    const testCaseId = parsedId.value;
    const org = detectOrgFromGitRemote();
    const args = ["boards", "work-item", "show", "--id", testCaseId, "--output", "json"];
    if (org !== null) {
        args.push("--org", org);
    }

    const result = runCommand("az", args, { env: azureEnv() });
    if (result.ok === false) {
        console.log(`ERROR: Failed to fetch test case #${testCaseId}. Ensure Azure CLI is authenticated and the test case exists.`);
        process.exit(1);
        return;
    }

    process.stdout.write(result.value);
}

main();
