export interface SessionMeta {
  sessionId: string;
  cwd: string;
  model: string;
  permissionMode?: string;
  lastActiveAt: number; // epoch ms
}

const TAG_PREFIX = '[CDB:';
const TAG_SUFFIX = ']';

/**
 * Encode session metadata into a channel topic string.
 * Appends a `[CDB:{...}]` tag at the end of any existing topic text.
 */
export function encodeTopic(meta: SessionMeta, existingTopic?: string): string {
  const tag = TAG_PREFIX + JSON.stringify(meta) + TAG_SUFFIX;
  const base = stripTag(existingTopic ?? '').trim();
  return base.length > 0 ? `${base} ${tag}` : tag;
}

/**
 * Decode session metadata from a channel topic string.
 * Returns null if no valid `[CDB:{...}]` tag is found.
 */
export function decodeTopic(topic: string | null | undefined): SessionMeta | null {
  if (!topic) return null;
  const start = topic.lastIndexOf(TAG_PREFIX);
  if (start < 0) return null;
  const jsonStart = start + TAG_PREFIX.length;
  const end = topic.indexOf(TAG_SUFFIX, jsonStart);
  if (end < 0) return null;
  try {
    const parsed = JSON.parse(topic.slice(jsonStart, end)) as SessionMeta;
    if (
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.cwd !== 'string' ||
      typeof parsed.model !== 'string' ||
      typeof parsed.lastActiveAt !== 'number'
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

function stripTag(topic: string): string {
  const start = topic.lastIndexOf(TAG_PREFIX);
  if (start < 0) return topic;
  const end = topic.indexOf(TAG_SUFFIX, start);
  if (end < 0) return topic;
  return (topic.slice(0, start) + topic.slice(end + TAG_SUFFIX.length)).trim();
}
