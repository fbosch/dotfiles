import { appendFile, readFile } from "node:fs/promises";
import {
  ConfigurationRequest,
  createProtocolConnection,
  type DefinitionParams,
  DefinitionRequest,
  type Diagnostic,
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DidSaveTextDocumentNotification,
  DocumentDiagnosticRequest,
  ExitNotification,
  type HoverParams,
  HoverRequest,
  InitializedNotification,
  type InitializeParams,
  InitializeRequest,
  PublishDiagnosticsNotification,
  type ReferenceParams,
  ReferencesRequest,
  ShutdownRequest,
} from "vscode-languageserver-protocol/node";

const connection = createProtocolConnection(process.stdin, process.stdout, {
  error() {},
  warn() {},
  info() {},
  log() {},
});
const documents = new Map<string, string>();
const hangRequests = process.argv.includes("--hang");
const hangInitialize = process.argv.includes("--hang-initialize");
const delayInitialize = process.argv.includes("--delay-initialize");
const incremental = process.argv.includes("--incremental");
const pullDiagnostics = process.argv.includes("--pull");

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const diagnosticBarrier = argumentValue("--diagnostic-barrier");
const diagnosticBarrierCount = Number(argumentValue("--diagnostic-barrier-count") ?? 2);
let configuration = Promise.resolve<unknown[]>([]);
let invalidIncrementalChange = false;

function diagnostics(uri: string): Diagnostic[] {
  const text = documents.get(uri) ?? "";
  return text.includes("BAD")
    ? [
        {
          message: "fake diagnostic",
          severity: 1,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 3 },
          },
        },
      ]
    : [];
}

function publish(uri: string): void {
  if (pullDiagnostics) return;
  connection.sendNotification(PublishDiagnosticsNotification.type, {
    uri,
    diagnostics: diagnostics(uri),
  });
}

connection.onRequest(InitializeRequest.type.method, async (_params: InitializeParams) => {
  if (hangInitialize) await new Promise(() => {});
  if (delayInitialize) await new Promise((resolve) => setTimeout(resolve, 100));
  return {
    capabilities: {
      definitionProvider: true,
      ...(pullDiagnostics ? { diagnosticProvider: { interFileDependencies: false } } : {}),
      hoverProvider: true,
      referencesProvider: true,
      textDocumentSync: incremental ? { change: 2, openClose: true } : 1,
    },
  };
});
connection.onNotification(InitializedNotification.type, () => {
  if (pullDiagnostics === false) return;
  configuration = connection.sendRequest(ConfigurationRequest.type, {
    items: [{ section: "lua.diagnostics" }, { section: "missing" }, {}],
  });
});
connection.onNotification(DidOpenTextDocumentNotification.type, ({ textDocument }) => {
  documents.set(textDocument.uri, textDocument.text);
  publish(textDocument.uri);
});
connection.onNotification(
  DidChangeTextDocumentNotification.type,
  ({ contentChanges, textDocument }) => {
    if (incremental && contentChanges.some((change) => "range" in change === false)) {
      invalidIncrementalChange = true;
    }
    const text = contentChanges.at(-1)?.text;
    if (text !== undefined) documents.set(textDocument.uri, text);
    publish(textDocument.uri);
  },
);
connection.onNotification(DidSaveTextDocumentNotification.type, ({ textDocument }) => {
  publish(textDocument.uri);
});
async function waitForDiagnosticBarrier(): Promise<void> {
  if (diagnosticBarrier === undefined) return;
  await appendFile(diagnosticBarrier, `${process.pid}\n`);
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const entries = new Set((await readFile(diagnosticBarrier, "utf8")).trim().split("\n"));
    if (entries.size >= diagnosticBarrierCount) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("fake diagnostic barrier timed out");
}

connection.onRequest(DocumentDiagnosticRequest.type.method, async ({ textDocument }) => {
  await waitForDiagnosticBarrier();
  return {
    kind: "full",
    items: diagnostics(textDocument.uri),
  };
});
connection.onRequest(HoverRequest.type.method, async (_params: HoverParams) => {
  if (hangRequests) await new Promise(() => {});
  let value = "fake hover";
  if (invalidIncrementalChange) value = "invalid incremental change";
  else if (pullDiagnostics) value = JSON.stringify(await configuration);
  return {
    contents: {
      kind: "plaintext",
      value,
    },
  };
});
connection.onRequest(
  DefinitionRequest.type.method,
  ({ position, textDocument }: DefinitionParams) => ({
    uri: textDocument.uri,
    range: { start: position, end: position },
  }),
);
connection.onRequest(
  ReferencesRequest.type.method,
  ({ position, textDocument }: ReferenceParams) => [
    { uri: textDocument.uri, range: { start: position, end: position } },
  ],
);
connection.onRequest(ShutdownRequest.type.method, () => null);
connection.onNotification(ExitNotification.type, () => process.exit(0));
connection.listen();
