const TRANSCRIPT_RECORDS_KEY = Symbol.for("dotfiles:pi-subagent-transcript-records");
const CACHE_VERSION = 1;
const MAX_RECORDS = 100;

export interface SubagentTranscriptRecord {
  id: string;
  status: string;
  outputFile?: string;
}

interface TranscriptRecordCache {
  version: typeof CACHE_VERSION;
  records: Map<string, Required<SubagentTranscriptRecord>>;
}

function transcriptRecordCache(): TranscriptRecordCache {
  const globals = globalThis as Record<symbol, unknown>;
  const cached = globals[TRANSCRIPT_RECORDS_KEY];
  if (
    typeof cached === "object" &&
    cached !== null &&
    "version" in cached &&
    cached.version === CACHE_VERSION &&
    "records" in cached &&
    cached.records instanceof Map
  ) {
    return cached as TranscriptRecordCache;
  }

  const created: TranscriptRecordCache = {
    version: CACHE_VERSION,
    records: new Map(),
  };
  globals[TRANSCRIPT_RECORDS_KEY] = created;
  return created;
}

/** Retain only service-origin paths; internal action URLs never carry local file paths. */
export function rememberSubagentTranscriptRecord(record: SubagentTranscriptRecord): void {
  if (record.outputFile === undefined) return;

  const records = transcriptRecordCache().records;
  records.delete(record.id);
  records.set(record.id, {
    id: record.id,
    status: record.status,
    outputFile: record.outputFile,
  });
  while (records.size > MAX_RECORDS) {
    const oldestId = records.keys().next().value;
    if (oldestId === undefined) break;
    records.delete(oldestId);
  }
}

export function rememberedSubagentTranscriptRecord(
  id: string,
): Required<SubagentTranscriptRecord> | undefined {
  return transcriptRecordCache().records.get(id);
}
