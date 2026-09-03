import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type BenchmarkOutput, installBenchmarkShutdown } from "../startup-shutdown";

type SessionHandler = (event: never, context: ExtensionContext) => void;

describe("startup benchmark shutdown", () => {
  test("requests graceful shutdown after a split TUI stop sequence", () => {
    const handlers = new Map<string, SessionHandler>();
    const writes: string[] = [];
    const originalWrite: BenchmarkOutput["write"] = (chunk) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    };
    const output: BenchmarkOutput = { write: originalWrite };
    const pi = {
      on(event: string, handler: SessionHandler) {
        handlers.set(event, handler);
      },
    } as unknown as ExtensionAPI;
    let shutdowns = 0;

    installBenchmarkShutdown(pi, output);
    handlers.get("session_start")?.(
      {} as never,
      {
        shutdown() {
          shutdowns += 1;
        },
      } as ExtensionContext,
    );

    output.write("before\x1b[?20");
    output.write("04lafter");

    expect(writes).toEqual(["before\x1b[?20", "04lafter"]);
    expect(shutdowns).toBe(1);
    expect(output.write).toBe(originalWrite);
  });

  test("restores stdout when the session shuts down first", () => {
    const handlers = new Map<string, SessionHandler>();
    const originalWrite: BenchmarkOutput["write"] = () => true;
    const output: BenchmarkOutput = { write: originalWrite };
    const pi = {
      on(event: string, handler: SessionHandler) {
        handlers.set(event, handler);
      },
    } as unknown as ExtensionAPI;

    installBenchmarkShutdown(pi, output);
    handlers.get("session_shutdown")?.({} as never, {} as ExtensionContext);

    expect(output.write).toBe(originalWrite);
  });
});
