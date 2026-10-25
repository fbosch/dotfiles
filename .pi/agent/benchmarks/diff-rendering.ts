import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { arch, cpus, platform, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CASES,
  type Engine,
  type Layout,
  positiveInteger,
  type Sample,
  summarize,
} from "./diff-rendering-model";

async function command(args: string[], timeout = 120_000) {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", timeout });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${args[0]} exited ${code}: ${stderr}`);
  if (stderr.trim()) console.error(stderr.trim());
  return stdout.trim();
}

async function treeHash(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(path: string) {
    for (const entry of (await readdir(join(root, path), { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const relative = join(path, entry.name);
      if (entry.isDirectory()) await visit(relative);
      else if (entry.isFile()) {
        hash
          .update(relative)
          .update("\0")
          .update(await readFile(join(root, relative)))
          .update("\0");
      }
    }
  }
  await visit("");
  return hash.digest("hex");
}

if (import.meta.main) {
  try {
    const rootArg = process.argv[2];
    if (!rootArg || process.argv.length !== 3) {
      throw new Error(
        "Usage: bun benchmarks/diff-rendering.ts /path/to/@pi-archimedes/diff > results.json",
      );
    }
    const root = resolve(rootArg);
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    if (manifest.name !== "@pi-archimedes/diff" || manifest.version !== "2.11.2") {
      throw new Error("This adapter targets @pi-archimedes/diff@2.11.2");
    }
    const trials = positiveInteger(process.env.PI_DIFF_TRIALS, 3);
    const runs = positiveInteger(process.env.PI_DIFF_RUNS, 10);
    const warmups = positiveInteger(process.env.PI_DIFF_WARMUPS, 3);
    if (trials > 20 || runs > 100 || warmups > 100)
      throw new Error("Run budget exceeds 20 trials or 100 runs/warmups");
    const here = dirname(fileURLToPath(import.meta.url));
    const sourceHash = await treeHash(join(root, "src"));
    const samples: Sample[] = [];
    const startedAt = new Date().toISOString();
    const deltaVersion = await command(["delta", "--version"]);
    const gitRevision = await command(["git", "rev-parse", "HEAD"]);
    const localFiles = [
      "diff-rendering.ts",
      "diff-rendering-worker.ts",
      "diff-rendering-model.ts",
      "delta-baseline.ts",
    ];
    const localHashes = Object.fromEntries(
      await Promise.all(
        localFiles.map(async (file) => [
          file,
          createHash("sha256")
            .update(await readFile(join(here, file)))
            .digest("hex"),
        ]),
      ),
    );
    for (const caseName of Object.keys(CASES)) {
      for (const layout of ["inline", "side-by-side"] as Layout[]) {
        for (let trial = 1; trial <= trials; trial++) {
          const engines: Engine[] = trial % 2 ? ["delta", "archimedes"] : ["archimedes", "delta"];
          for (const engine of engines) {
            console.error(`${caseName}/${layout} trial ${trial}/${trials}: ${engine}`);
            const result = JSON.parse(
              await command([
                process.execPath,
                join(here, "diff-rendering-worker.ts"),
                root,
                engine,
                caseName,
                layout,
                String(trial),
                String(runs),
                String(warmups),
              ]),
            );
            if (!Array.isArray(result.samples) || result.samples.length !== 1 + runs * 2) {
              throw new Error("Worker returned an incomplete sample set");
            }
            samples.push(...result.samples);
          }
        }
      }
    }
    if (sourceHash !== (await treeHash(join(root, "src"))))
      throw new Error("Archimedes sources changed during run");
    for (const [file, hash] of Object.entries(localHashes)) {
      if (
        hash !==
        createHash("sha256")
          .update(await readFile(join(here, file)))
          .digest("hex")
      ) {
        throw new Error(`Benchmark source changed during run: ${file}`);
      }
    }
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          complete: true,
          metadata: {
            startedAt,
            finishedAt: new Date().toISOString(),
            runtime: { bun: Bun.version, node: process.version },
            host: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model },
            deltaVersion,
            archimedesVersion: manifest.version,
            archimedesSourceHash: sourceHash,
            gitRevision,
            localHashes,
            trials,
            runs,
            warmups,
            cases: CASES,
            widths: { inline: 120, "side-by-side": 200 },
            themes: { delta: "Zenwritten Dark", archimedes: "github-dark" },
            policy:
              "Prepared diffs; full output; imports, parsing, verification and hashing excluded. Delta process startup and pipe I/O included. First render uses a fresh worker, not a cold OS cache. Arms run serially, order alternates per trial.",
            limitations:
              "Synthetic TypeScript; no terminal painting, UI stall, CPU, memory or repaint measurements. Large Archimedes inputs skip syntax highlighting. Different themes and word emphasis; no automatic winner or significance claim.",
          },
          summary: summarize(samples),
          samples,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
