// Regenerate with: bun run extensions/typo-abolish/__tests__/fixtures/regenerate.ts /path/to/plugin/abolish.vim
// Fetch that file at the revision below; the hash prevents recording a different oracle.
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const revision = "dcbfe065297d31823561ba787f51056c147aa682";
const sha256 = "ba6f5b206d2a3d3611ff9cb00d0923e32bd73ffec19d5a22394278b18ad0e41c";
const plugin = process.argv[2];
if (!plugin) throw new Error("Pass the pinned plugin/abolish.vim path");
const source = await readFile(plugin);
if (createHash("sha256").update(source).digest("hex") !== sha256) {
  throw new Error(`Expected tpope/vim-abolish ${revision}; source hash differs`);
}
const root = new URL("../../../../../../", import.meta.url);
const lock = JSON.parse(await readFile(new URL(".config/nvim/nvim-pack-lock.json", root), "utf8"));
if (lock.plugins?.["vim-abolish"]?.rev !== revision) {
  throw new Error("Update the oracle revision and hash after reviewing the Neovim lockfile change");
}
const shared = await readFile(new URL(".config/fbb/data/typos.abolish", root), "utf8");
const directory = await mkdtemp(join(tmpdir(), "abolish-oracle-"));
try {
  const input = join(directory, "input.json");
  const output = join(directory, "output.json");
  await writeFile(
    input,
    JSON.stringify({
      shared,
      cases: [
        "teh the",
        "foo_ bar_",
        "foo__bar foo__baz",
        "succes{,ful,fully} success{,ful,fully}",
        "commmand{s,} command{}",
        "a{x,y,z} b{1,2}",
        "a{x,y}{m,n} b{1,2}{3,4}",
        "depend{e,a}nc{ie,ei,y,i}es dependencies",
        "im I'm\ncompationRatio compactionRatio",
        "æblet æble\n1stt 1st\n_foo _bar",
        "alot a lot",
      ],
      boundaries: [
        "teh",
        "'teh",
        "æteh",
        "øteh",
        "åteh",
        "λteh",
        "中teh",
        "𐐀teh",
        "áteh",
        "_teh",
        "1teh",
        "×teh",
        "÷teh",
        "²teh",
        "/teh",
      ],
    }),
  );
  const child = Bun.spawn(
    [
      "nvim",
      "--headless",
      "-u",
      "NONE",
      "-i",
      "NONE",
      "-l",
      new URL("./abolish-oracle.lua", import.meta.url).pathname,
      plugin,
      input,
      output,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`Neovim oracle failed (${code}): ${stdout}\n${stderr}`);
  const result = JSON.parse(await readFile(output, "utf8"));
  const fixture = {
    reference: {
      repository: "tpope/vim-abolish",
      revision,
      sha256,
      iskeyword: "@,48-57,_,192-255",
    },
    ...result,
  };
  const json = JSON.stringify(
    fixture,
    (_key, value: unknown) => {
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        return Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        );
      }
      return value;
    },
    2,
  );
  await writeFile(new URL("./abolish-reference.json", import.meta.url), `${json}\n`);
  console.log(
    `Recorded ${result.cases.length} parity cases and ${Object.keys(result.shared).length} shared abbreviations`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
