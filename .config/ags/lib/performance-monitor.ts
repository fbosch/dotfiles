import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";

const PERF_FLAG_PATH = "/tmp/ags-benchmark-mode";
const PERF_LOG_PATH = "/tmp/ags-performance.jsonl";

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
  try {
    const file = Gio.File.new_for_path(PERF_LOG_PATH);
    const stream = file.append_to(Gio.FileCreateFlags.NONE, null);
    const line = JSON.stringify(record) + "\n";
    const bytes = new TextEncoder().encode(line);
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
    this.start = nowMs();
    this.rssBefore = getRssKb();
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
};
