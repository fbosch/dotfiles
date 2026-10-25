import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildDeltaInvocation, executeDeltaProcess } from "./delta-baseline";
import {
  CASES,
  type CaseName,
  type Engine,
  fixture,
  type Layout,
  type Phase,
  positiveInteger,
  required,
  type Sample,
  verifyOutput,
} from "./diff-rendering-model";

const [rootArg, engineArg, caseArg, layoutArg, trialArg, runsArg, warmupsArg] =
  process.argv.slice(2);
if (
  !rootArg ||
  !["delta", "archimedes"].includes(engineArg ?? "") ||
  !(caseArg && Object.hasOwn(CASES, caseArg)) ||
  !["inline", "side-by-side"].includes(layoutArg ?? "")
) {
  throw new Error("Invalid diff-rendering worker arguments");
}
const root = resolve(rootArg);
const engine = engineArg as Engine;
const caseName = caseArg as CaseName;
const layout = layoutArg as Layout;
const trial = positiveInteger(trialArg, 1);
const runs = positiveInteger(runsArg, 10);
const warmups = positiveInteger(warmupsArg, 3);
const width = layout === "inline" ? 120 : 200;
const moduleUrl = (path: string) => pathToFileURL(resolve(root, path)).href;

// Both arms prepare their representations before timing; neither measures line diffing.
const { parseDiff } = await import(moduleUrl("src/core/diff.ts"));
const { createTwoFilesPatch } = await import(
  pathToFileURL(createRequire(resolve(root, "package.json")).resolve("diff")).href
);
const base = fixture(caseName, 0);
const baseParsed = parseDiff(base.oldContent, base.newContent);
const basePatch = createTwoFilesPatch(
  "a/fixture.ts",
  "b/fixture.ts",
  base.oldContent,
  base.newContent,
);
// Variants change only equal-length tags, so line positions and patch structure stay identical.
// Prepare one diff rather than repeating quadratic line matching outside the timed region.
const prepared = Array.from({ length: runs + warmups + 2 }, (_, variant) => {
  const tag = String(variant).padStart(5, "0");
  const vary = (text: string) => text.replaceAll("_00000_", `_${tag}_`);
  return {
    ...fixture(caseName, variant),
    parsed: {
      ...baseParsed,
      lines: baseParsed.lines.map((line: { content: string }) => ({
        ...line,
        content: vary(line.content),
      })),
    },
    patch: vary(basePatch),
  };
});
const { renderSplitLines } = await import(moduleUrl("src/render/split.ts"));
const { setConfigGetter } = await import(moduleUrl("src/render/shared.ts"));
const { setConfigGetter: setShikiConfig } = await import(moduleUrl("src/shiki.ts"));
setConfigGetter(() => ({
  diffSplitMinWidth: 150,
  diffSplitMinCodeWidth: 60,
  diffSplitWrapCheck: false,
}));
setShikiConfig(() => ({ diffTheme: "github-dark" }));

const args = buildDeltaInvocation(layout, width);
const render = async (index: number): Promise<string> => {
  const input = required(prepared[index]);
  if (engine === "archimedes") {
    // Render all rows so neither engine wins by silently limiting the viewport.
    return (
      await renderSplitLines(input.parsed, "typescript", width, input.parsed.lines.length)
    ).join("\n");
  }
  const result = await executeDeltaProcess(args, input.patch, {
    cwd: process.cwd(),
    timeout: 10_000,
  });
  if (result.code !== 0 || result.killed || result.stderr.trim()) {
    throw new Error(`Delta failed: code=${result.code}, killed=${result.killed}, ${result.stderr}`);
  }
  return result.stdout;
};
const samples: Sample[] = [];
async function measure(phase: Phase | undefined, index: number, iteration: number) {
  const start = performance.now();
  const output = await render(index);
  const durationMs = performance.now() - start;
  const input = required(prepared[index]);
  verifyOutput(output, input.oldContent, input.newContent);
  if (phase) {
    const visibleRows = layout === "inline" ? input.parsed.lines.length : CASES[caseName];
    samples.push({
      engine,
      caseName,
      layout,
      trial,
      phase,
      iteration,
      durationMs,
      outputBytes: Buffer.byteLength(output),
      outputHash: createHash("sha256").update(output).digest("hex"),
      archimedesHighlightEligible: input.parsed.chars <= 80_000 && visibleRows <= 150,
    });
  }
}
await measure("first-render", 0, 0);
for (let i = 0; i < warmups; i++) await measure(undefined, i + 1, i);
for (let i = 0; i < runs; i++) await measure("warm-unique", warmups + 1 + i, i);
// Explicitly prime the repeated input, independently of the unique-input phase.
await measure(undefined, 0, 0);
for (let i = 0; i < runs; i++) await measure("warm-repeat", 0, i);
console.log(JSON.stringify({ samples }));
