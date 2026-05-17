import { describe, it, expect } from 'vitest';
import { StreamingMessage, openFenceCarry } from '../src/ui/streamingMessage.js';

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
