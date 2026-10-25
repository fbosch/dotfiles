import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { structuredPatch } from "diff";
import { createDiffRenderer } from "../engine";
import { runEditDiff, runGitDiff } from "../execution";
import { type DiffRenderEngine, ESCAPE } from "../shared";

const engine = createDiffRenderer("zenwritten_dark");
beforeAll(() => engine.prewarm());
afterAll(() => engine.dispose());
const patch = (old: string, next: string, path = "sample.ts") =>
  structuredPatch(path, path, old, next, undefined, undefined, { context: 3 });

describe("Shiki diff rendering", () => {
  test("frames split output and hatches only missing source lines", async () => {
    const result = await engine.render([patch("keep\n\n", "keep\nextra\n\n")], {
      width: 160,
      display: "side-by-side",
      auto: false,
    });
    const rows = stripVTControlCharacters(result.output).split("\n");
    expect(rows[1]).toMatch(/^─+┊─+$/u);
    expect(rows.find((line) => line.includes("extra"))).toContain("╱");
    const blank = rows.find((line) => line.startsWith("  2  │"));
    expect(blank).toBeDefined();
    expect(blank).not.toContain("╱");
    expect(rows.every((line) => visibleWidth(line) <= 160)).toBe(true);
  });
  test("fills missing cells on wrapped rows but not continuation padding for real lines", async () => {
    const added = await engine.render([patch("keep\n", "keep\n" + "æøå".repeat(80) + "\n")], {
      width: 120,
      display: "side-by-side",
      auto: false,
    });
    expect(
      stripVTControlCharacters(added.output)
        .split("\n")
        .filter((line) => line.includes("╱")).length,
    ).toBeGreaterThan(1);
    const changed = await engine.render([patch("short\n", "æøå".repeat(80) + "\n")], {
      width: 120,
      display: "side-by-side",
      auto: false,
    });
    expect(stripVTControlCharacters(changed.output)).not.toContain("╱");
    expect(Math.max(...changed.output.split("\n").map(visibleWidth))).toBeLessThanOrEqual(120);
  });
  test("uses Archimedes split thresholds and labeled hunk separators", async () => {
    const input = [patch("before\n", "after\n")];
    expect((await engine.render(input, { width: 149, display: "side-by-side" })).display).toBe(
      "inline",
    );
    expect((await engine.render(input, { width: 150, display: "side-by-side" })).display).toBe(
      "side-by-side",
    );
    const largeNumbers = patch("before\n", "after\n");
    for (const hunk of largeNumbers.hunks) {
      hunk.oldStart = 100000000000;
      hunk.newStart = 100000000000;
    }
    expect(
      (await engine.render([largeNumbers], { width: 150, display: "side-by-side" })).display,
    ).toBe("inline");
    const source = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const result = await engine.render(
      [patch(source, source.replace("line 0\n", "first\n").replace("line 29", "last"))],
      {
        width: 100,
        display: "inline",
      },
    );
    expect(stripVTControlCharacters(result.output)).toContain("unmodified lines");
  });

  test("renders zenwritten_dark syntax, diff backgrounds and word emphasis", async () => {
    const result = await engine.render(
      [patch('const name = "før";\n', 'const name = "efter";\n')],
      {
        width: 120,
        display: "side-by-side",
        auto: false,
      },
    );
    const plain = stripVTControlCharacters(result.output);
    expect(plain).toContain('const name = "før";');
    expect(plain).toContain('const name = "efter";');
    expect(result.output).toContain(`${ESCAPE}[38;2;187;187;187m`);
    expect(result.output).toContain(`${ESCAPE}[48;2;35;45;26m`);
    expect(result.output).toContain(`${ESCAPE}[48;2;62;34;37m`);
    expect(result.output).toContain(`${ESCAPE}[48;2;53;70;41m`);
    expect(result.display).toBe("side-by-side");
  });
  test("wraps narrow and Unicode lines without exceeding the terminal width", async () => {
    const source = 'const 文 = "' + "æøå😀".repeat(20) + '";\n';
    const result = await engine.render([patch(source, source.replace("const", "let"))], {
      width: 40,
      display: "inline",
    });
    expect(Math.max(...result.output.split("\n").map(visibleWidth))).toBeLessThanOrEqual(40);
    expect(stripVTControlCharacters(result.output)).toContain("æøå😀");
  });
  test("auto falls back to inline when split code columns wrap too often", async () => {
    const text = Array.from(
      { length: 10 },
      (_, i) => `const name${i} = "${"a".repeat(100)}";`,
    ).join("\n");
    const result = await engine.render([patch(text, text.replaceAll("const", "let"))], {
      width: 120,
      display: "side-by-side",
      auto: true,
    });
    expect(result.display).toBe("inline");
  });
  test("preserves insertions, deletions, blank lines, EOF markers and hunk numbers", async () => {
    const result = await engine.render([patch("before\n\nlast", "after\n\nlast\n")], {
      width: 100,
      display: "inline",
    });
    const plain = stripVTControlCharacters(result.output);
    expect(plain).toContain("before");
    expect(plain).toContain("after");
    expect(plain).toContain("No newline at end of file");
    expect(plain).toMatch(/▌ 1- │/u);
    expect(plain).toMatch(/▌ 1\+ │/u);
  });
  test("rejects source terminal controls without stripping Danish letters", async () => {
    const result = await engine.render(
      [patch("old", `æøå${ESCAPE}]52;c;ZXZpbA==\u0007${ESCAPE}[2J${ESCAPE}[31mnew`)],
      {
        width: 100,
        display: "inline",
      },
    );
    expect(result.output).not.toContain("]52;");
    expect(result.output).not.toContain(`${ESCAPE}[2J`);
    expect(result.output).not.toContain(`${ESCAPE}[31m`);
    expect(stripVTControlCharacters(result.output)).toContain("æøånew");
  });
  test("honors pre-aborted rendering", async () => {
    await expect(
      engine.render([patch("a", "b")], {
        width: 120,
        display: "inline",
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow();
  });
});

describe("in-process diff execution", () => {
  test("renders edits without file snapshots", async () => {
    const result = await runEditDiff(
      { path: "src/example.ts", oldContent: "const n = 1;\n", newContent: "const n = 2;\n" },
      "/repo",
      { engine, columns: 120 },
    );
    expect(stripVTControlCharacters(result.output)).toContain("const n = 2;");
    expect(result.scope).toBe("edit changes");
    const empty = await runEditDiff(
      { path: "a.ts", oldContent: "same", newContent: "same" },
      "/repo",
      { engine },
    );
    expect(empty.noChanges).toBe(true);
  });
  test("runs safely separated Git args and renders prepared patches", async () => {
    const calls: string[][] = [];
    const result = await runGitDiff(
      async (_command, args) => {
        calls.push(args);
        return {
          code: 0,
          killed: false,
          stderr: "",
          stdout: "--- a/sample.ts\n+++ b/sample.ts\n@@ -1 +1 @@\n-old\n+new\n",
        };
      },
      { revision: "HEAD", paths: ["path with spaces.ts"] },
      "/repo",
      { engine, columns: 120 },
    );
    expect(calls[0]).toContain("--no-ext-diff");
    expect(calls[0]?.slice(-3)).toEqual(["HEAD", "--", "path with spaces.ts"]);
    expect(result.content).toContain("old");
    expect(result.content).toContain("new");
  });
  test("keeps binary and metadata-only changes visible", async () => {
    const raw = "diff --git a/a.png b/a.png\nBinary files a/a.png and b/a.png differ\n";
    const result = await runGitDiff(
      async () => ({ code: 0, killed: false, stderr: "", stdout: raw }),
      {},
      "/repo",
      { engine },
    );
    expect(result.content).toContain("Binary files");
    expect(result.details.noChanges).toBe(false);
  });
  test("preserves metadata beside text changes", async () => {
    const raw =
      "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/a.png b/a.png\nBinary files a/a.png and b/a.png differ\ndiff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n";
    const result = await runGitDiff(
      async () => ({ code: 0, killed: false, stderr: "", stdout: raw }),
      {},
      "/repo",
      { engine },
    );
    expect(result.content).toContain("new");
    expect(result.content).toContain("Binary files a/a.png and b/a.png differ");
    expect(result.content).toContain("new mode 100755");
  });
  test("reports sanitized Git errors and cancellation", async () => {
    await expect(
      runGitDiff(
        async () => ({
          code: 128,
          killed: false,
          stdout: "",
          stderr: `${ESCAPE}[31mfatal${ESCAPE}[0m`,
        }),
        {},
        "/repo",
        { engine },
      ),
    ).rejects.toThrow("Could not read Git diff:\nfatal");
    await expect(
      runGitDiff(async () => ({ code: 0, killed: false, stdout: "", stderr: "" }), {}, "/repo", {
        engine,
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow();
  });
  test("saves full output when bounded output truncates and preserves save failures", async () => {
    const output = Array.from({ length: 2001 }, (_, i) => `line ${i}`).join("\n");
    let saved = "";
    const fake: DiffRenderEngine = {
      prewarm: async () => {},
      dispose: async () => {},
      render: async () => ({ output, display: "inline" }),
    };
    const execute = async () => ({
      code: 0,
      killed: false,
      stderr: "",
      stdout: "--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b\n",
    });
    const result = await runGitDiff(execute, {}, "/repo", {
      engine: fake,
      writeFullOutput: async (text) => {
        saved = text;
        return "/tmp/full-diff";
      },
    });
    expect(saved).toContain("line 2000");
    expect(result.details.truncation).toBeDefined();
    expect(result.details.fullOutputPath).toBe("/tmp/full-diff");
    const failure = await runGitDiff(execute, {}, "/repo", {
      engine: fake,
      writeFullOutput: async () => {
        throw new Error("read-only");
      },
    });
    expect(failure.details.warning).toContain("read-only");
  });
});
