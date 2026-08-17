import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";

const RUNTIME_DIR = GLib.getenv("XDG_RUNTIME_DIR") || GLib.get_tmp_dir();
const PERF_FLAG_PATH = `${RUNTIME_DIR}/ags-benchmark-mode`;
const PERF_LOG_PATH = `${RUNTIME_DIR}/ags-performance.jsonl`;

type PerfRecord = {
  component: string;
  name: string;
  start_ms: number;
  duration_ms: number;
  rss_before_kb: number;
  rss_after_kb: number;
  ok: boolean;
  error?: string;
};

type ExternalTiming = {
  durationMs: number;
  name: string;
  startMs: number;
};

function isEnabled(): boolean {
  try {
    const flag = Gio.File.new_for_path(PERF_FLAG_PATH);
    return flag.query_exists(null);
  } catch {
    return false;
  }
}

function nowMs(): number {
  return GLib.get_monotonic_time() / 1000;
}

function getRssKb(): number {
  try {
    const [ok, contents] = GLib.file_get_contents("/proc/self/status");
    if (!ok || !contents) return 0;
    const text = new TextDecoder("utf-8").decode(contents);
    const match = text.match(/VmRSS:\s+(\d+)/);
    return match ? Number.parseInt(match[1], 10) : 0;
  } catch {
    return 0;
  }
}

function appendRecord(record: PerfRecord) {
	appendRecords([record]);
}

function appendRecords(records: PerfRecord[]) {
  try {
    const file = Gio.File.new_for_path(PERF_LOG_PATH);
    const stream = file.append_to(Gio.FileCreateFlags.NONE, null);
    const output = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
    const bytes = new TextEncoder().encode(output);
    stream.write_all(bytes, null);
    stream.close(null);
  } catch (e) {
    console.error("Failed to write performance log:", e);
  }
}

class NoopMark {
  end(): void {}
}

class PerfMark {
  private readonly start: number;
  private readonly rssBefore: number;
  private ended = false;

  constructor(
    private readonly component: string,
    private readonly name: string,
  ) {
    this.rssBefore = getRssKb();
    this.start = nowMs();
  }

  end(ok = true, error?: string): void {
    if (this.ended) return;
    this.ended = true;
    const end = nowMs();
    const record: PerfRecord = {
      component: this.component,
      name: this.name,
      start_ms: this.start,
      duration_ms: end - this.start,
      rss_before_kb: this.rssBefore,
      rss_after_kb: getRssKb(),
      ok,
      error,
    };
    appendRecord(record);
  }
}

let perfEnabled = isEnabled();

export const perf = {
  isEnabled(): boolean {
    return perfEnabled;
  },
  refresh(): void {
    perfEnabled = isEnabled();
  },
  start(component: string, name: string): NoopMark | PerfMark {
    if (!perfEnabled) {
      perfEnabled = isEnabled();
    }
    if (!perfEnabled) return new NoopMark();
    return new PerfMark(component, name);
  },
  record(component: string, timings: ExternalTiming[]): void {
    if (!perfEnabled || timings.length === 0) return;
    const rss = getRssKb();
    appendRecords(
      timings.map(({ durationMs, name, startMs }) => ({
        component,
        duration_ms: durationMs,
        name,
        start_ms: startMs,
        rss_before_kb: rss,
        rss_after_kb: rss,
        ok: true,
      })),
    );
  },
};
