import { describe, it, expect } from 'vitest';
import { StreamingMessage, openFenceCarry, tailThinkingLines } from '../src/ui/streamingMessage.js';

describe('openFenceCarry', () => {
  it('returns empty when no fence is open', () => {
    expect(openFenceCarry('hello world')).toBe('');
    expect(openFenceCarry('```ts\nfoo\n```')).toBe('');
  });

  it('reopens a plain fence when left open', () => {
    expect(openFenceCarry('```\nfoo')).toBe('```\n');
  });

  it('reopens a language-tagged fence', () => {
    expect(openFenceCarry('text\n```python\nprint(1)')).toBe('```python\n');
  });
});

describe('tailThinkingLines', () => {
  it('returns the last 3 non-empty lines', () => {
    const out = tailThinkingLines('one\ntwo\nthree\nfour\nfive');
    expect(out).toBe('three\nfour\nfive');
  });

  it('strips trailing blank lines', () => {
    const out = tailThinkingLines('a\nb\nc\n\n\n');
    expect(out).toBe('a\nb\nc');
  });

  it('keeps the tail of overly long lines', () => {
    const long = 'x'.repeat(300);
    const out = tailThinkingLines(`short\n${long}`);
    const last = out.split('\n').pop()!;
    expect(last.length).toBeLessThanOrEqual(120);
    expect(last.startsWith('…')).toBe(true);
    expect(last.endsWith('xxx')).toBe(true);
  });
});

describe('StreamingMessage', () => {
  it('accepts thinking deltas without throwing', () => {
    const stream = new StreamingMessage({ send: async () => ({ edit: async () => undefined }) } as never);
    expect(() => stream.appendThinking('thinking')).not.toThrow();
  });

  it('calls onFirstMessage when it sends the first streaming embed', async () => {
    let called = false;
    const stream = new StreamingMessage(
      { send: async () => ({ edit: async () => undefined }) } as never,
      { onFirstMessage: () => { called = true; } },
    );
    stream.appendText('hello');
    await stream.finalize();
    expect(called).toBe(true);
  });
});
