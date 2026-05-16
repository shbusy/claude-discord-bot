import { describe, it, expect } from 'vitest';
import { StreamParser } from '../src/claude/streamParser.js';
import type { StreamEvent } from '../src/claude/types.js';

function collect(...chunks: string[]): { events: StreamEvent[]; malformed: { line: string; msg: string }[] } {
  const events: StreamEvent[] = [];
  const malformed: { line: string; msg: string }[] = [];
  const p = new StreamParser(
    (e) => events.push(e),
    (line, err) => malformed.push({ line, msg: err.message }),
  );
  for (const c of chunks) p.feed(c);
  p.flush();
  return { events, malformed };
}

describe('StreamParser', () => {
  it('parses one event per JSONL line', () => {
    const { events, malformed } = collect(
      '{"type":"system","subtype":"init","session_id":"s","cwd":"/x","model":"sonnet","tools":[]}\n',
      '{"type":"assistant","message":{"id":"m","role":"assistant","model":"sonnet","content":[{"type":"text","text":"hi"}]},"session_id":"s"}\n',
    );
    expect(malformed).toHaveLength(0);
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe('system');
    expect(events[1]!.type).toBe('assistant');
  });

  it('handles partial chunks and reassembles across feed boundaries', () => {
    const { events, malformed } = collect('{"type":"system",', '"subtype":"init","session_id":"x","cwd":"/y","model":"sonnet","tools":[]}\n');
    expect(malformed).toHaveLength(0);
    expect(events).toHaveLength(1);
  });

  it('skips empty lines and reports malformed lines without throwing', () => {
    const { events, malformed } = collect('\n\n', 'not json\n', '{"type":"result","subtype":"success","is_error":false,"duration_ms":1,"num_turns":1,"session_id":"s"}\n');
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('result');
    expect(malformed).toHaveLength(1);
    expect(malformed[0]!.line).toBe('not json');
  });

  it('flushes a trailing line without newline', () => {
    const { events, malformed } = collect('{"type":"result","subtype":"success","is_error":false,"duration_ms":1,"num_turns":1,"session_id":"s"}');
    expect(malformed).toHaveLength(0);
    expect(events).toHaveLength(1);
  });

  it('rejects events missing the type field', () => {
    const { events, malformed } = collect('{"foo":"bar"}\n');
    expect(events).toHaveLength(0);
    expect(malformed).toHaveLength(1);
  });
});
