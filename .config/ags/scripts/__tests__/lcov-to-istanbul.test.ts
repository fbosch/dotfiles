import { expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { convertLcov, parseLcov } from "../lcov-to-istanbul";

const fixturePath = resolve(import.meta.dir, "fixtures/lcov-sample.ts");
const fixtureRoot = dirname(fixturePath);

test("parses LCOV line and function records", () => {
  const [file] = parseLcov(
    [
      "TN:",
      "SF:lcov-sample.ts",
      "FN:1,covered",
      "FNDA:5,covered",
      "DA:1,5",
      "end_of_record",
    ].join("\n"),
  );

  expect(file.source).toBe("lcov-sample.ts");
  expect(file.lineHits.get(1)).toBe(5);
  expect(file.functionDeclarations.get("covered")).toEqual([1]);
  expect(file.functionHits.get("covered")).toBe(5);
});

test("rejects malformed LCOV records", () => {
  expect(() => parseLcov("DA:1,1\nend_of_record")).toThrow("before SF");
  expect(() => parseLcov("SF:fixture.ts\nDA:1,\nend_of_record")).toThrow("Invalid DA");
  expect(() => parseLcov("SF:fixture.ts\nend_of_record\nend_of_record")).toThrow(
    "Unexpected end_of_record",
  );
  expect(() => parseLcov(`SF:fixture.ts\nDA:1,${Number.MAX_SAFE_INTEGER + 1}\nend_of_record`)).toThrow(
    "Invalid DA",
  );
  expect(() => parseLcov(`SF:fixture.ts\nFNDA:${Number.MAX_SAFE_INTEGER + 1},callback\nend_of_record`)).toThrow(
    "Invalid FNDA",
  );
});

test("converts source-level LCOV into an Istanbul coverage map", async () => {
  const coverage = await convertLcov(
    [
      "TN:",
      "SF:lcov-sample.ts",
      "FN:1,covered",
      "FNDA:5,covered",
      "DA:1,5",
      "DA:2,5",
      "DA:3,0",
      "DA:6,0",
      "DA:9,1",
      "DA:10,1",
      "DA:15,1",
      "DA:17,0",
      "DA:18,0",
      "DA:19,1",
      "end_of_record",
    ].join("\n"),
    fixtureRoot,
  );
  const file = coverage[fixturePath];

  expect(file.path).toBe(fixturePath);
  expect(file.s).toEqual({
    "0": 5,
    "1": 5,
    "2": 0,
    "3": 0,
    "4": 1,
    "5": 1,
    "6": 1,
    "7": 0,
    "8": 0,
    "9": 1,
  });
  expect(Object.values(file.fnMap).map((functionInfo) => functionInfo.name)).toEqual([
    "covered",
    "(anonymous_1)",
    "method",
    "(anonymous_3)",
    "entryLineDeterminesCoverage",
  ]);
  expect(file.f).toEqual({ "0": 5, "1": 0, "2": 1, "3": 0, "4": 0 });
  expect(file.fnMap["0"]).toMatchObject({
    decl: { start: { line: 1, column: 16 }, end: { line: 1, column: 23 } },
    loc: { start: { line: 1, column: 48 }, end: { line: 4, column: 1 } },
    line: 1,
  });
  expect(file.fnMap["1"]).toMatchObject({
    decl: { start: { line: 6, column: 25 }, end: { line: 6, column: 26 } },
    loc: { start: { line: 6, column: 39 }, end: { line: 6, column: 50 } },
    line: 6,
  });
  expect(file.branchMap).toEqual({});
  expect(file.b).toEqual({});
});

test("rejects repeated source records and out-of-range source lines", async () => {
  const repeatedSourceRecords = [
    "SF:lcov-sample.ts",
    "DA:1,1",
    "end_of_record",
    "SF:lcov-sample.ts",
    "DA:1,1",
    "end_of_record",
  ].join("\n");
  await expect(
    convertLcov(repeatedSourceRecords, fixtureRoot),
  ).rejects.toThrow("Duplicate LCOV source record");

  await expect(
    convertLcov(["SF:lcov-sample.ts", "DA:999,1", "end_of_record"].join("\n"), fixtureRoot),
  ).rejects.toThrow("missing source line");

  await expect(
    convertLcov(["SF:../lcov-to-istanbul.test.ts", "DA:1,1", "end_of_record"].join("\n"), fixtureRoot),
  ).rejects.toThrow("outside source root");
});
