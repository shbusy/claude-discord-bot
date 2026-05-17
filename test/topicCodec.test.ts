import { describe, it, expect } from 'vitest';
import { encodeTopic, decodeTopic, type SessionMeta } from '../src/session/topicCodec.js';

const sample: SessionMeta = {
  sessionId: 'abc-123',
  cwd: '/Users/test/project',
  model: 'sonnet',
  permissionMode: 'default',
  lastActiveAt: 1715875200000,
};

describe('topicCodec', () => {
  it('encode → decode 왕복', () => {
    const topic = encodeTopic(sample);
    const decoded = decodeTopic(topic);
    expect(decoded).toEqual(sample);
  });

  it('기존 토픽 텍스트를 보존한다', () => {
    const topic = encodeTopic(sample, '이 채널은 프론트엔드 세션입니다');
    expect(topic).toContain('이 채널은 프론트엔드 세션입니다');
    const decoded = decodeTopic(topic);
    expect(decoded).toEqual(sample);
  });

  it('태그 없는 토픽에서 null 반환', () => {
    expect(decodeTopic('일반 채널 설명')).toBeNull();
    expect(decodeTopic(null)).toBeNull();
    expect(decodeTopic(undefined)).toBeNull();
    expect(decodeTopic('')).toBeNull();
  });

  it('잘못된 JSON 태그에서 null 반환', () => {
    expect(decodeTopic('[CDB:not-json]')).toBeNull();
  });

  it('필수 필드 누락 시 null 반환', () => {
    expect(decodeTopic('[CDB:{"sessionId":"x"}]')).toBeNull();
  });

  it('CLI가 sessionId를 발급하기 전의 빈 sessionId도 복원한다', () => {
    const topic = encodeTopic({ ...sample, sessionId: '' });
    expect(decodeTopic(topic)).toEqual({ ...sample, sessionId: '' });
  });

  it('기존 태그를 교체한다', () => {
    const first = encodeTopic(sample, '설명');
    const updated: SessionMeta = { ...sample, model: 'opus' };
    const second = encodeTopic(updated, first);
    const decoded = decodeTopic(second);
    expect(decoded?.model).toBe('opus');
    // 태그가 중복되지 않는지 확인
    const matches = second.match(/\[CDB:/g);
    expect(matches).toHaveLength(1);
  });
});
