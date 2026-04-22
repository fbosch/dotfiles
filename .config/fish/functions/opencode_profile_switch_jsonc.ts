#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs";

function stripComments(text: string): string {
    const out: string[] = [];
    let i = 0;
    const length = text.length;
    let inString = false;
    let escaped = false;

    while (i < length) {
        const ch = text[i];
        const nxt = i + 1 < length ? text[i + 1] : "";

        if (inString) {
            out.push(ch);
            if (escaped) {
                escaped = false;
            } else if (ch === "\\") {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            i += 1;
            continue;
        }

        if (ch === '"') {
            inString = true;
            out.push(ch);
            i += 1;
            continue;
        }

        if (ch === "/" && nxt === "/") {
            i += 2;
            while (i < length && text[i] !== "\n") {
                i += 1;
            }
            continue;
        }

        if (ch === "/" && nxt === "*") {
            i += 2;
            while (i + 1 < length && !(text[i] === "*" && text[i + 1] === "/")) {
                i += 1;
            }
            i += 2;
            continue;
        }

        out.push(ch);
        i += 1;
    }

    return out.join("");
}

function stripTrailingCommas(text: string): string {
    const out: string[] = [];
    let i = 0;
    const length = text.length;
    let inString = false;
    let escaped = false;

    while (i < length) {
        const ch = text[i];

        if (inString) {
            out.push(ch);
            if (escaped) {
                escaped = false;
            } else if (ch === "\\") {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            i += 1;
            continue;
        }

        if (ch === '"') {
            inString = true;
            out.push(ch);
            i += 1;
            continue;
        }

        if (ch === ",") {
            let j = i + 1;
            while (j < length && " \t\r\n".includes(text[j])) {
                j += 1;
            }
            if (j < length && "}]".includes(text[j])) {
                i += 1;
                continue;
            }
        }

        out.push(ch);
        i += 1;
    }

    return out.join("");
}

function main(): number {
    const args = process.argv.slice(2);
    if (args.length !== 2) {
        return 2;
    }

    const [sourcePath, targetPath] = args;
    const raw = readFileSync(sourcePath, "utf8");
    const normalized = stripTrailingCommas(stripComments(raw));
    const parsed = JSON.parse(normalized);
    writeFileSync(targetPath, JSON.stringify(parsed), "utf8");
    return 0;
}

process.exit(main());
