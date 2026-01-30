#!/usr/bin/env node
/*
Estimate token counts using tokenx (fast, approximate).

Usage:
  node scripts/token_estimate.mjs --file path/to/text
  node scripts/token_estimate.mjs --text "Hello"
  node scripts/token_estimate.mjs --file path/to/text --chars-per-token 4
*/

import fs from "node:fs";
import process from "node:process";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") {
      args.file = argv[i + 1];
      i += 1;
    } else if (arg === "--text") {
      args.text = argv[i + 1];
      i += 1;
    } else if (arg === "--chars-per-token") {
      args.charsPerToken = Number(argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

function readText({ file, text }) {
  if (file) {
    return fs.readFileSync(file, "utf8");
  }
  if (text) {
    return text;
  }
  return "";
}

const args = parseArgs(process.argv.slice(2));
const content = readText(args);

if (!content) {
  console.error("No content provided. Use --file or --text.");
  process.exit(1);
}

const options = {};
if (Number.isFinite(args.charsPerToken)) {
  options.defaultCharsPerToken = args.charsPerToken;
}

const script = `
import { estimateTokenCount } from "tokenx";
import fs from "node:fs";

const input = fs.readFileSync(0, "utf8");
const options = ${JSON.stringify(options)};
const tokens = estimateTokenCount(input, options);
console.log(\`estimated_tokens=\${tokens}\`);
`;

const result = spawnSync(
  "npx",
  ["-y", "-p", "tokenx", "node", "--input-type=module", "-e", script],
  { input: content, encoding: "utf8" }
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  process.stderr.write(result.stderr || "");
  process.exit(result.status ?? 1);
}

process.stdout.write(result.stdout || "");
