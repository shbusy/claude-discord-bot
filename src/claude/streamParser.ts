import type { StreamEvent } from './types.js';

/**
 * Buffers a UTF-8 byte stream and emits one event per JSONL line.
 * Tolerates partial reads, blank lines, and lines that are not JSON
 * (those are reported via `onMalformed` for observability and dropped).
 */
export class StreamParser {
  private buf = '';

  constructor(
    private readonly onEvent: (e: StreamEvent) => void,
    private readonly onMalformed?: (line: string, err: Error) => void,
  ) {}

  feed(chunk: string | Buffer): void {
    this.buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line.length === 0) continue;
      this.parseLine(line);
    }
  }

  flush(): void {
    const tail = this.buf.trim();
    this.buf = '';
    if (tail.length > 0) this.parseLine(tail);
  }

  private parseLine(line: string): void {
    try {
      const ev = JSON.parse(line) as StreamEvent;
      if (typeof ev !== 'object' || ev === null || typeof (ev as { type: unknown }).type !== 'string') {
        throw new Error('event missing type field');
      }
      this.onEvent(ev);
    } catch (e) {
      this.onMalformed?.(line, e as Error);
    }
  }
}
