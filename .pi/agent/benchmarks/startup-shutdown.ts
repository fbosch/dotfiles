import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const TUI_STOP_SEQUENCE = "\x1b[?2004l";

type BenchmarkWrite = (chunk: string | Uint8Array, ...args: unknown[]) => boolean;

export interface BenchmarkOutput {
  write: BenchmarkWrite;
}

export function installBenchmarkShutdown(pi: ExtensionAPI, output: BenchmarkOutput): void {
  let context: ExtensionContext | undefined;
  let tail = "";
  const originalWrite = output.write;
  const restoreWrite = () => {
    output.write = originalWrite;
  };

  output.write = (chunk, ...args) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    const buffered = tail + text;
    tail = buffered.slice(-(TUI_STOP_SEQUENCE.length - 1));
    const result = Reflect.apply(originalWrite, output, [chunk, ...args]) as boolean;

    // Pi's benchmark mode stops the TUI without shutting down extension resources.
    // Request normal shutdown only after that stop is observable on stdout.
    if (buffered.includes(TUI_STOP_SEQUENCE)) {
      restoreWrite();
      context?.shutdown();
    }
    return result;
  };

  pi.on("session_start", (_event, ctx) => {
    context = ctx;
  });
  pi.on("session_shutdown", () => {
    restoreWrite();
    context = undefined;
  });
}

export default function benchmarkShutdown(pi: ExtensionAPI): void {
  if (process.env.PI_STARTUP_BENCHMARK !== "1") return;
  installBenchmarkShutdown(pi, process.stdout as unknown as BenchmarkOutput);
}
