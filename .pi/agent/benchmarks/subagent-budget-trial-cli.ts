import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type BudgetTrialOptions, runBudgetTrial } from "./subagent-budget-trial";

export function isTrialOptions(value: unknown): value is BudgetTrialOptions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const data = Object.fromEntries(Object.entries(value));
  return (
    Object.keys(data).length === 6 &&
    ["sdkRoot", "cwd", "directory", "prompt"].every((key) => {
      const field = data[key];
      return typeof field === "string" && field.length > 0 && field.length <= 32_768;
    }) &&
    (data.arm === "fixed" || data.arm === "advisory" || data.arm === "reference") &&
    typeof data.timeoutMs === "number" &&
    Number.isSafeInteger(data.timeoutMs) &&
    data.timeoutMs > 0 &&
    data.timeoutMs <= 120_000
  );
}

if (import.meta.main) {
  let options: BudgetTrialOptions | undefined;
  try {
    const input: unknown = JSON.parse(await Bun.stdin.text());
    if (!isTrialOptions(input)) throw new Error("Invalid private trial input");
    options = input;
    const result = await runBudgetTrial(options);
    await writeFile(join(options.directory, "result.json"), JSON.stringify(result, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if (options) {
      try {
        await writeFile(
          join(options.directory, "failure.json"),
          JSON.stringify(
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : { name: "UnknownError" },
          ),
          { mode: 0o600, flag: "wx" },
        );
      } catch {
        console.error("Could not save private trial failure details.");
      }
    }
    console.error("Pilot trial failed; see private failure.json.");
    process.exitCode = 1;
  }
}
