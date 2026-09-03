import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TUI_STOP_SEQUENCE = "\x1b[?2004l";

type BenchmarkWrite = (chunk: string | Uint8Array, ...args: unknown[]) => boolean;

export interface BenchmarkOutput {
  write: BenchmarkWrite;
}

export interface BenchmarkRuntime {
  defer(callback: () => void): void;
  exit(code: number): never;
}

export function installBenchmarkShutdown(output: BenchmarkOutput, runtime: BenchmarkRuntime): void {
  let tail = "";
  const originalWrite = output.write;

  output.write = (chunk, ...args) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    const buffered = tail + text;
    tail = buffered.slice(-(TUI_STOP_SEQUENCE.length - 1));
    const result = Reflect.apply(originalWrite, output, [chunk, ...args]) as boolean;

    if (buffered.includes(TUI_STOP_SEQUENCE)) {
      output.write = originalWrite;
      // Benchmark mode returns after stopping the TUI and never services
      // ExtensionContext.shutdown(). Exit on the next turn so this write can flush.
      runtime.defer(() => runtime.exit(0));
    }
    return result;
  };
}

export default function benchmarkShutdown(_pi: ExtensionAPI): void {
  if (process.env.PI_STARTUP_BENCHMARK !== "1") return;
  installBenchmarkShutdown(process.stdout as unknown as BenchmarkOutput, {
    defer: setImmediate,
    exit: process.exit,
  });
}
