import { describe, expect, test } from "bun:test";
import { inspectCommand } from "../inspection";

describe("local command warning evidence", () => {
  test("locates name and flag matches on their original source line", () => {
    const command = "printf 'æøå';\n  rm -rf ./src";
    const inspection = inspectCommand(command);
    if (inspection.kind !== "review") throw new Error("Expected review");
    expect(inspection.evidence).toContain('Operation name: "rm" (line 2, column 3)');
    expect(inspection.evidence).toContain('Force flag: "-rf" (line 2, column 6)');
    expect(inspection.input.state).toMatchObject({
      operations: ["rm"],
      recursive: true,
      force: true,
    });
  });

  test("uses the same lexical indicators for quoted code and local explanation", () => {
    const inspection = inspectCommand("cd src && printf '%s' 'rm(directory)' > test.ts");
    if (inspection.kind !== "review") throw new Error("Expected review");
    expect(inspection.evidence).toContain('Operation name: "rm" (line 1, column 24)');
    expect(inspection.input.state).toMatchObject({
      operations: ["rm"],
      outputRedirection: true,
    });
  });

  test("keeps source-bearing evidence outside the provider request", () => {
    const command = "scp PRIVATE_FILE user@PRIVATE_HOST:PRIVATE_DEST";
    const inspection = inspectCommand(command);
    if (inspection.kind !== "review") throw new Error("Expected review");
    expect(inspection.evidence.join("\n")).toContain("PRIVATE_HOST");
    const request = JSON.stringify(inspection.input);
    for (const value of ["PRIVATE_FILE", "PRIVATE_HOST", "PRIVATE_DEST"])
      expect(request).not.toContain(value);
    expect(inspection.input).not.toHaveProperty("evidence");
    expect(inspection.input.state).toMatchObject({
      operations: ["scp"],
      networkDestination: true,
      localDataReference: true,
    });
  });
});
