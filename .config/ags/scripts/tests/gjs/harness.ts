type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const testCases: TestCase[] = [];

export function test(name: string, run: TestCase["run"]): void {
  testCases.push({ name, run });
}

export function assert(condition: boolean, message: string): asserts condition {
  if (condition === false) throw new Error(message);
}

export async function runSuite(): Promise<void> {
  const failures: string[] = [];

  for (const testCase of testCases) {
    try {
      await testCase.run();
      console.log(`PASS ${testCase.name}`);
    } catch (error) {
      failures.push(`${testCase.name}: ${String(error)}`);
      console.error(`FAIL ${testCase.name}:`, error);
    }
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length} GJS test(s) failed\n${failures.join("\n")}`);
  }

  console.log(`${testCases.length} GJS test(s) passed`);
}
