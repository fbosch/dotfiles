import { mkdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import * as ts from "typescript";

interface LcovFile {
  source: string;
  lineHits: Map<number, number>;
  functionDeclarations: Map<string, number[]>;
  functionHits: Map<string, number>;
}

interface IstanbulLocation {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

interface IstanbulFunction {
  name: string;
  decl: IstanbulLocation;
  loc: IstanbulLocation;
  line: number;
}

interface IstanbulFileCoverage {
  path: string;
  all: boolean;
  statementMap: Record<string, IstanbulLocation>;
  s: Record<string, number>;
  fnMap: Record<string, IstanbulFunction>;
  f: Record<string, number>;
  branchMap: Record<string, never>;
  b: Record<string, number[]>;
  inputSourceMap: null;
  _coverageSchema: "1a1c01bbd47fc00a2c39e90264f3330500441537";
  hash: string;
}

export type IstanbulCoverage = Record<string, IstanbulFileCoverage>;

function parseLineHit(value: string, lineNumber: number): [number, number] {
  const match = /^([1-9]\d*),(\d+)$/.exec(value);
  if (!match) {
    throw new Error(`Invalid DA record at LCOV line ${lineNumber}: ${value}`);
  }
  const line = Number(match[1]);
  const hits = Number(match[2]);
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(hits)) {
    throw new Error(`Invalid DA record at LCOV line ${lineNumber}: ${value}`);
  }
  return [line, hits];
}

function parseFunctionDeclaration(value: string, lineNumber: number): [string, number] {
  const match = /^([1-9]\d*),(.+)$/.exec(value);
  if (!match || match[2].trim() === "") {
    throw new Error(`Invalid FN record at LCOV line ${lineNumber}: ${value}`);
  }
  const sourceLine = Number(match[1]);
  if (!Number.isSafeInteger(sourceLine)) {
    throw new Error(`Invalid FN record at LCOV line ${lineNumber}: ${value}`);
  }
  return [match[2], sourceLine];
}

function parseFunctionHit(
  value: string,
  lineNumber: number,
): [string, number] {
  const separator = value.indexOf(",");
  if (separator === -1) {
    throw new Error(`Invalid FNDA record at LCOV line ${lineNumber}: ${value}`);
  }

  const hitsText = value.slice(0, separator);
  const name = value.slice(separator + 1);
  if (!/^\d+$/.test(hitsText) || name.trim() === "") {
    throw new Error(`Invalid FNDA record at LCOV line ${lineNumber}: ${value}`);
  }
  const hits = Number(hitsText);
  if (!Number.isSafeInteger(hits)) {
    throw new Error(`Invalid FNDA record at LCOV line ${lineNumber}: ${value}`);
  }
  return [name, hits];
}

export function parseLcov(contents: string): LcovFile[] {
  const files: LcovFile[] = [];
  let current: LcovFile | null = null;

  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    if (line === "") continue;
    if (line.startsWith("TN:")) {
      if (current) throw new Error(`Unexpected TN record at LCOV line ${lineNumber}`);
      continue;
    }
    if (line === "end_of_record") {
      if (!current) throw new Error(`Unexpected end_of_record at LCOV line ${lineNumber}`);
      files.push(current);
      current = null;
      continue;
    }
    if (line.startsWith("SF:")) {
      if (current) {
        throw new Error(`Missing end_of_record before LCOV line ${lineNumber}`);
      }
      const source = line.slice(3);
      if (source === "") throw new Error(`Missing source path at LCOV line ${lineNumber}`);
      current = {
        source,
        lineHits: new Map(),
        functionDeclarations: new Map(),
        functionHits: new Map(),
      };
      continue;
    }
    if (!current) throw new Error(`Coverage record before SF at LCOV line ${lineNumber}`);
    if (line.startsWith("DA:")) {
      const [sourceLine, hits] = parseLineHit(line.slice(3), lineNumber);
      if (current.lineHits.has(sourceLine)) {
        throw new Error(`Duplicate DA record at LCOV line ${lineNumber}: ${line.slice(3)}`);
      }
      current.lineHits.set(sourceLine, hits);
      continue;
    }
    if (line.startsWith("FN:")) {
      const [name, sourceLine] = parseFunctionDeclaration(line.slice(3), lineNumber);
      current.functionDeclarations.set(name, [
        ...(current.functionDeclarations.get(name) ?? []),
        sourceLine,
      ]);
      continue;
    }
    if (line.startsWith("FNDA:")) {
      const [name, hits] = parseFunctionHit(line.slice(5), lineNumber);
      if (current.functionHits.has(name)) {
        throw new Error(`Duplicate FNDA record at LCOV line ${lineNumber}: ${name}`);
      }
      current.functionHits.set(name, hits);
      continue;
    }
    if (/^BRDA:[1-9]\d*,\d+,\d+,(\d+|-)$/.test(line)) continue;
    if (/^(FNF|FNH|LF|LH|BRF|BRH):\d+$/.test(line)) continue;
    throw new Error(`Unsupported LCOV record at line ${lineNumber}: ${line}`);
  }

  if (current) {
    throw new Error("LCOV input ended without end_of_record");
  }
  return files;
}

function location(
  sourceFile: ts.SourceFile,
  start: number,
  end: number,
): IstanbulLocation {
  const startPosition = sourceFile.getLineAndCharacterOfPosition(start);
  const endPosition = sourceFile.getLineAndCharacterOfPosition(end);
  return {
    start: { line: startPosition.line + 1, column: startPosition.character },
    end: { line: endPosition.line + 1, column: endPosition.character },
  };
}

function functionName(
  node: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
  index: number,
): string {
  if (node.name) return node.name.getText(sourceFile);
  return `(anonymous_${index})`;
}

function isTrackedFunction(node: ts.Node): node is ts.FunctionLikeDeclaration {
  if (
    ts.isArrowFunction(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return node.body !== undefined;
  }
  return false;
}

function functionHitCount(
  node: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
  name: string,
  lineHits: Map<number, number>,
  functionDeclarations: Map<string, number[]>,
  functionHits: Map<string, number>,
): number {
  const declarationLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const declaredLines = functionDeclarations.get(name);
  const reportedHits = functionHits.get(name);
  if (
    declaredLines?.length === 1 &&
    declaredLines[0] === declarationLine &&
    reportedHits !== undefined
  ) {
    return reportedHits;
  }

  const body = node.body;
  if (!body) return 0;
  if (ts.isBlock(body) === false) return 0;

  const entry = body.statements[0];
  if (!entry) return 0;
  // Bun omits FNDA, so only a directly entered body line can prove invocation.
  const entryLine = sourceFile.getLineAndCharacterOfPosition(entry.getStart(sourceFile)).line + 1;
  const bodyLine = sourceFile.getLineAndCharacterOfPosition(body.getStart(sourceFile)).line + 1;
  if (entryLine === bodyLine) return 0;
  return lineHits.get(entryLine) ?? 0;
}

function createFileCoverage(
  sourcePath: string,
  source: string,
  lcov: LcovFile,
): IstanbulFileCoverage {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);
  const sourceLines = source.split(/\r?\n/);
  const statementMap: Record<string, IstanbulLocation> = {};
  const statements: Record<string, number> = {};
  for (const [index, [line, hits]] of [...lcov.lineHits.entries()]
    .sort(([left], [right]) => left - right)
    .entries()) {
    if (line > sourceLines.length) {
      throw new Error(`${sourcePath}: LCOV references missing source line ${line}`);
    }
    const key = String(index);
    statementMap[key] = {
      start: { line, column: 0 },
      end: { line, column: sourceLines[line - 1]?.length ?? 0 },
    };
    statements[key] = hits;
  }

  const fnMap: Record<string, IstanbulFunction> = {};
  const functions: Record<string, number> = {};
  let functionIndex = 0;
  function visit(node: ts.Node): void {
    if (isTrackedFunction(node)) {
      const key = String(functionIndex);
      const name = functionName(node, sourceFile, functionIndex);
      const declarationStart = node.name?.getStart(sourceFile) ?? node.getStart(sourceFile);
      const declarationEnd = node.name?.end ?? declarationStart + 1;
      const body = node.body;
      if (!body) return;
      fnMap[key] = {
        name,
        decl: location(sourceFile, declarationStart, declarationEnd),
        loc: location(sourceFile, body.getStart(sourceFile), body.end),
        line: sourceFile.getLineAndCharacterOfPosition(body.getStart(sourceFile)).line + 1,
      };
      functions[key] = functionHitCount(
        node,
        sourceFile,
        name,
        lcov.lineHits,
        lcov.functionDeclarations,
        lcov.functionHits,
      );
      functionIndex += 1;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return {
    path: sourcePath,
    all: false,
    statementMap,
    s: statements,
    fnMap,
    f: functions,
    branchMap: {},
    b: {},
    inputSourceMap: null,
    _coverageSchema: "1a1c01bbd47fc00a2c39e90264f3330500441537",
    hash: "",
  };
}

export async function convertLcov(
  contents: string,
  sourceRoot: string,
): Promise<IstanbulCoverage> {
  const coverage: IstanbulCoverage = {};
  const canonicalRoot = await realpath(sourceRoot);
  for (const lcov of parseLcov(contents)) {
    const candidatePath = isAbsolute(lcov.source)
      ? lcov.source
      : resolve(canonicalRoot, lcov.source);
    const sourcePath = await realpath(candidatePath);
    const pathFromRoot = relative(canonicalRoot, sourcePath);
    if (
      pathFromRoot === "" ||
      pathFromRoot === ".." ||
      pathFromRoot.startsWith(`..${sep}`) ||
      isAbsolute(pathFromRoot)
    ) {
      throw new Error(`LCOV source is outside source root: ${lcov.source}`);
    }
    if ((await stat(sourcePath)).isFile() === false) {
      throw new Error(`LCOV source is not a regular file: ${lcov.source}`);
    }
    if (coverage[sourcePath]) {
      throw new Error(`Duplicate LCOV source record: ${lcov.source}`);
    }
    const source = await readFile(sourcePath, "utf8");
    coverage[sourcePath] = createFileCoverage(sourcePath, source, lcov);
  }
  return coverage;
}

async function main(argv: string[]): Promise<void> {
  const [inputPath, outputPath, sourceRoot = process.cwd()] = argv;
  if (!inputPath || !outputPath || argv.length > 3) {
    throw new Error(
      "Usage: lcov-to-istanbul.ts <lcov.info> <coverage-final.json> [source-root]",
    );
  }

  const coverage = await convertLcov(await readFile(inputPath, "utf8"), sourceRoot);
  await mkdir(dirname(outputPath), { recursive: true });
  await Bun.write(outputPath, `${JSON.stringify(coverage, null, 2)}\n`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
