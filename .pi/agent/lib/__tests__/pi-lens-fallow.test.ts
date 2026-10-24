import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

const agentRoot = resolve(import.meta.dir, "../..");
const bundle = readFileSync(resolve(agentRoot, "npm/node_modules/pi-lens/dist/index.js"), "utf8");
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function section(startMarker: string, endMarker: string): string {
  const start = bundle.indexOf(startMarker);
  const end = bundle.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Missing Pi Lens section: ${startMarker}`);
  return bundle.slice(start, end);
}

function catalog(
  resolveAndLaunch: (
    spec: { candidates: string[]; args: string[]; cwd: string },
    install: boolean,
  ) => unknown,
) {
  const source = section("    LSP_SERVERS = [", "\n    ];").replace("    LSP_SERVERS = ", "");
  const code = `${source}]`;
  const names = [...source.matchAll(/^ {6}(\w+Server),?$/gm)].map((match) => match[1]);
  const servers = Object.fromEntries(
    names.map((name) => [
      name,
      {
        id: name,
        role:
          name === "TyposServer" ||
          name === "AstGrepServer" ||
          name === "OpengrepServer" ||
          name === "ZizmorServer"
            ? "auxiliary"
            : "language",
      },
    ]),
  );
  return runInNewContext(code, {
    ...servers,
    path58: path,
    NearestRoot: (markers: string[]) => markers,
    resolveAndLaunch,
  }) as { id: string; role: string; root: string[]; spawn(root: string): Promise<unknown> }[];
}

function profile() {
  const code = `${section("    AUXILIARY_LSP_PROFILES = [", '\n      {\n        serverId: "opengrep"').replace("    AUXILIARY_LSP_PROFILES = [", "[")}]`;
  const profiles = runInNewContext(code) as {
    serverId: string;
    sourceMatch: RegExp;
    enabledByDefault: boolean;
    allowBlocking(): boolean;
    semantic(): string;
  }[];
  const fallow = profiles.find((value) => value.serverId === "fallow");
  if (!fallow) throw new Error("Fallow auxiliary profile missing");
  return fallow;
}

test("Fallow is auxiliary while TypeScript remains a primary candidate", async () => {
  const calls: unknown[] = [];
  const servers = catalog((spec, install) => {
    calls.push({ spec, install });
    return Promise.resolve({ process: "fixture" });
  });
  const fallow = servers.find((server) => server.id === "fallow");
  if (!fallow) throw new Error("Fallow server missing");
  expect(fallow.role).toBe("auxiliary");
  expect(servers.filter((server) => server.role === "language")[0]?.id).toBe("TypeScriptServer");
  expect(fallow.root).toEqual([".fallowrc.json", ".fallowrc.jsonc", "fallow.toml", ".fallow.toml"]);
  await fallow.spawn("/fixture/project");
  expect(calls).toEqual([
    {
      spec: {
        candidates: ["/fixture/project/node_modules/.bin/fallow-lsp", "fallow-lsp"],
        args: [],
        cwd: "/fixture/project",
      },
      install: false,
    },
  ]);
});

test("Fallow findings participate in auxiliary selection but never block edits", () => {
  const fallow = profile();
  expect(fallow.sourceMatch.test("fallow")).toBe(true);
  expect(fallow.allowBlocking()).toBe(false);
  expect(fallow.semantic()).toBe("warning");
  const choose = runInNewContext(
    `${section("function enabledAuxiliaryLspServerIds(", "\nfunction configDisabledAuxiliaryLspServerIds")}\nenabledAuxiliaryLspServerIds`,
    {
      AUXILIARY_LSP_PROFILES: [fallow],
      shouldDegradeAuxiliaryLsp: () => false,
      isSubagentSession: () => false,
      isEnabledByConfiguration: (value: { enabledByDefault: boolean }) => value.enabledByDefault,
    },
  ) as (getFlag: () => boolean) => string[];
  expect(choose(() => false)).toEqual(["fallow"]);
});

test("the installed Fallow LSP publishes dead-code diagnostics", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "pi-lens-fallow-live-"));
  directories.push(root);
  writeFileSync(resolve(root, "package.json"), '{"type":"module"}\n');
  writeFileSync(resolve(root, ".fallowrc.json"), '{"entry":["index.ts"]}\n');
  writeFileSync(resolve(root, "index.ts"), 'import { used } from "./util";\nconsole.log(used);\n');
  const content = "export const used = 1;\nexport const unused = 2;\n";
  writeFileSync(resolve(root, "util.ts"), content);
  const proc = spawn(resolve(agentRoot, "node_modules/.bin/fallow-lsp"), [], {
    cwd: root,
    stdio: "pipe",
  });
  let buffer = Buffer.alloc(0);
  let stderr = "";
  const seen: unknown[] = [];
  const send = (message: object) => {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  try {
    const diagnostic = await new Promise<{ source?: string; message: string }>(
      (resolveDiagnostic, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(`No Fallow diagnostic. stderr=${stderr}; messages=${JSON.stringify(seen)}`),
            ),
          10000,
        );
        const finish = (value?: { source?: string; message: string }, error?: Error) => {
          clearTimeout(timer);
          if (error) reject(error);
          else if (value) resolveDiagnostic(value);
        };
        proc.on("error", (error) => finish(undefined, error));
        proc.on("exit", (code) => finish(undefined, new Error(`Fallow exited ${code}: ${stderr}`)));
        proc.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        proc.stdout.on("data", (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk]);
          while (true) {
            const boundary = buffer.indexOf("\r\n\r\n");
            if (boundary < 0) return;
            const length = Number(
              /Content-Length: (\d+)/i.exec(buffer.subarray(0, boundary).toString())?.[1],
            );
            if (!Number.isFinite(length)) {
              finish(undefined, new Error("Invalid LSP frame"));
              return;
            }
            if (buffer.length < boundary + 4 + length) return;
            const message = JSON.parse(
              buffer.subarray(boundary + 4, boundary + 4 + length).toString(),
            );
            buffer = buffer.subarray(boundary + 4 + length);
            seen.push(message);
            if (message.id === 1 && message.result) {
              send({ method: "initialized", params: {} });
              const uri = pathToFileURL(resolve(root, "util.ts")).href;
              send({
                method: "textDocument/didOpen",
                params: {
                  textDocument: { uri, languageId: "typescript", version: 1, text: content },
                },
              });
              send({
                method: "textDocument/didSave",
                params: { textDocument: { uri }, text: content },
              });
            } else if (message.method && message.id !== undefined) {
              send({
                id: message.id,
                result: message.method === "workspace/configuration" ? [] : null,
              });
            }
            for (const finding of message.params?.diagnostics ?? []) {
              if (finding.source === "fallow" && /unused/i.test(finding.message)) finish(finding);
            }
          }
        });
        send({
          id: 1,
          method: "initialize",
          params: {
            processId: process.pid,
            rootUri: pathToFileURL(root).href,
            capabilities: {},
            workspaceFolders: [{ uri: pathToFileURL(root).href, name: "fixture" }],
          },
        });
      },
    );
    expect(profile().sourceMatch.test(diagnostic.source ?? "")).toBe(true);
    expect(diagnostic.message).toMatch(/unused/i);
  } finally {
    proc.kill();
  }
}, 15000);
