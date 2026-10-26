import { createHash } from "node:crypto";
import type { ClassifierRequest, ClassifierResponse } from "./classifier-compaction";

export class ClassifierDecisionCache {
  private readonly entries = new Map<string, ClassifierResponse>();
  constructor(private readonly capacity = 64) {}

  scope(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }
  private key(scope: string, request: ClassifierRequest): string {
    return this.scope([scope, request]);
  }
  get(scope: string, request: ClassifierRequest): ClassifierResponse | undefined {
    const value = this.entries.get(this.key(scope, request));
    return value ? structuredClone(value) : undefined;
  }
  set(scope: string, request: ClassifierRequest, response: ClassifierResponse): void {
    const key = this.key(scope, request);
    const value = structuredClone(response);
    // A reused decision incurs no new provider usage.
    delete value.usage;
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
