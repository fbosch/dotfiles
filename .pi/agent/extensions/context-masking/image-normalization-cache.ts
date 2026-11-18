export class ImageNormalizationCache {
  private readonly entries = new Map<string, Buffer>();
  private bytes = 0;

  constructor(private readonly capacity = 32, private readonly maxBytes = 8_000_000) {}

  get(key: string): Buffer | undefined {
    const value = this.entries.get(key);
    if (!value) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return Buffer.from(value);
  }

  set(key: string, value: Buffer): void {
    const previous = this.entries.get(key);
    if (previous) { this.bytes -= previous.length; this.entries.delete(key); }
    if (!value.length || value.length > this.maxBytes || this.capacity <= 0) return;
    this.entries.set(key, Buffer.from(value));
    this.bytes += value.length;
    while (this.entries.size > this.capacity || this.bytes > this.maxBytes) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) break;
      this.bytes -= oldest[1].length;
      this.entries.delete(oldest[0]);
    }
  }
}
