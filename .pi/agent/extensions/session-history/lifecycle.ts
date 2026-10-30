import { reconcile, syncFile } from "./indexer";
import { HistoryStore } from "./store";

export interface IndexStatus {
  /** True while startup reconciliation runs; queries answer from the existing index. */
  readonly updating: boolean;
  /** Message from the last failed sync, cleared by the next successful reconciliation. */
  readonly failure?: string;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Owns the history index for one extension instance. All index writes run through one queue,
 * so reconciliation and live syncs never interleave within a process; shutdown aborts pending
 * reconciliation, syncs the current session, and closes the store.
 */
export class HistoryIndex {
  private store: Promise<HistoryStore> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private controller = new AbortController();
  private reconciling = false;
  private failure: string | undefined;

  constructor(private readonly directory: string) {}

  status(): IndexStatus {
    return {
      updating: this.reconciling,
      ...(this.failure === undefined ? {} : { failure: this.failure }),
    };
  }

  /** Opens the store on first use; queries may run while reconciliation is in progress. */
  open(): Promise<HistoryStore> {
    this.store ??= HistoryStore.open(this.directory);
    return this.store;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /**
   * Starts reconciling the index with `root`. Callers may leave the returned promise detached:
   * it never rejects, and failures surface through `status()`.
   */
  reconcile(root: string): Promise<void> {
    const signal = this.controller.signal;
    this.reconciling = true;
    return this.enqueue(async () => reconcile(await this.open(), root, signal))
      .then(() => {
        this.failure = undefined;
      })
      .catch((error: unknown) => {
        if (!signal.aborted) this.failure = message(error);
      })
      .finally(() => {
        this.reconciling = false;
      });
  }

  /** Indexes content appended to one session file. Never rejects; failures surface in `status()`. */
  sync(path: string | undefined): Promise<void> {
    if (!path) return Promise.resolve();
    return this.enqueue(async () => {
      await syncFile(await this.open(), path);
    }).catch((error: unknown) => {
      this.failure = message(error);
    });
  }

  async shutdown(currentFile: string | undefined): Promise<void> {
    this.controller.abort();
    await this.queue;
    this.controller = new AbortController();
    await this.sync(currentFile);
    const store = this.store;
    this.store = undefined;
    if (store) (await store.catch(() => undefined))?.close();
  }
}
