import { describe, expect, test } from "bun:test";
import {
  type BenchmarkOutput,
  type BenchmarkRuntime,
  installBenchmarkShutdown,
} from "../startup-shutdown";

describe("startup benchmark shutdown", () => {
  test("exits after a split TUI stop sequence", () => {
    const writes: string[] = [];
    const deferred: Array<() => void> = [];
    const exits: number[] = [];
    const originalWrite: BenchmarkOutput["write"] = (chunk) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    };
    const output: BenchmarkOutput = { write: originalWrite };
    const runtime: BenchmarkRuntime = {
      defer(callback) {
        deferred.push(callback);
      },
      exit(code): never {
        exits.push(code);
        throw new Error("exit");
      },
    };

    installBenchmarkShutdown(output, runtime);
    output.write("before\x1b[?20");
    output.write("04lafter");

    expect(writes).toEqual(["before\x1b[?20", "04lafter"]);
    expect(exits).toEqual([]);
    expect(output.write).toBe(originalWrite);
    expect(() => deferred[0]?.()).toThrow("exit");
    expect(exits).toEqual([0]);
  });

  test("does not exit for ordinary output", () => {
    const deferred: Array<() => void> = [];
    const originalWrite: BenchmarkOutput["write"] = () => true;
    const output: BenchmarkOutput = { write: originalWrite };

    installBenchmarkShutdown(output, {
      defer(callback) {
        deferred.push(callback);
      },
      exit(): never {
        throw new Error("unexpected exit");
      },
    });
    output.write("ready");

    expect(deferred).toEqual([]);
    expect(output.write).not.toBe(originalWrite);
  });
});
