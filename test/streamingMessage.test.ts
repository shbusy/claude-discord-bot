import { describe, it, expect } from 'vitest';
import { openFenceCarry } from '../src/ui/streamingMessage.js';

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
