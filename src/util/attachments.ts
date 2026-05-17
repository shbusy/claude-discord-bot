import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { Attachment, Message } from 'discord.js';
import { isPathInsideRoot } from './pathSecurity.js';

const MAX_ATTACHMENTS_PER_MESSAGE = 10;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const ALLOWED_ATTACHMENT_HOSTS = new Set([
  'cdn.discordapp.com',
  'media.discordapp.net',
]);

export interface SavedAttachment {
  name: string;
  url: string;
  contentType?: string | null;
  size?: number;
  filePath: string;
}

export async function saveMessageAttachments(msg: Message, cdbHome: string): Promise<SavedAttachment[]> {
  if (msg.attachments.size === 0) return [];
  if (msg.attachments.size > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new Error(`첨부 파일은 메시지당 최대 ${MAX_ATTACHMENTS_PER_MESSAGE}개까지 허용됩니다.`);
  }
  const dir = resolve(cdbHome, 'attachments', msg.channelId, msg.id);
  await mkdir(dir, { recursive: true });
  const saved: SavedAttachment[] = [];
  for (const attachment of msg.attachments.values()) {
    saved.push(await saveAttachment(attachment, dir));
  }
  return saved;
}

export function extractOutputFilePath(toolName: string, input: unknown, cwd: string): string | null {
  if (toolName !== 'Write') return null;
  if (!input || typeof input !== 'object') return null;
  const filePath = (input as { file_path?: unknown }).file_path;
  if (typeof filePath !== 'string' || filePath.length === 0) return null;
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

export function shouldAttachOutputFile(filePath: string, cwd: string): boolean {
  return isPathInsideRoot(filePath, cwd);
}

export function formatAttachmentsForPrompt(files: SavedAttachment[]): string {
  if (files.length === 0) return '';
  return [
    '첨부 파일은 로컬에 저장되어 있습니다. 필요한 경우 아래 경로를 읽으세요:',
    ...files.map((f) => {
      const meta = [
        f.contentType ? `type=${f.contentType}` : undefined,
        typeof f.size === 'number' ? `size=${f.size}` : undefined,
        `source=${f.url}`,
      ].filter(Boolean).join(' ');
      return `- ${f.name}: ${f.filePath}${meta ? ` (${meta})` : ''}`;
    }),
  ].join('\n');
}

async function saveAttachment(attachment: Attachment, dir: string): Promise<SavedAttachment> {
  validateAttachmentUrl(attachment.url);
  if (typeof attachment.size === 'number' && attachment.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`첨부 파일이 너무 큽니다: ${attachment.name ?? attachment.id}`);
  }
  const name = sanitizeFilename(attachment.name ?? attachment.id);
  const filePath = resolve(dir, `${sanitizeFilename(attachment.id)}-${name}`);
  if (!isPathInsideRoot(filePath, dir)) {
    throw new Error('잘못된 첨부 파일 이름입니다.');
  }
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`첨부 파일 다운로드 실패: ${attachment.url} (${response.status})`);
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_ATTACHMENT_BYTES) {
    throw new Error(`첨부 파일이 너무 큽니다: ${attachment.name ?? attachment.id}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (data.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(`첨부 파일이 너무 큽니다: ${attachment.name ?? attachment.id}`);
  }
  await writeFile(filePath, data);
  return {
    name,
    url: attachment.url,
    contentType: attachment.contentType,
    size: attachment.size,
    filePath,
  };
}

export function validateAttachmentUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('잘못된 첨부 파일 URL입니다.');
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_ATTACHMENT_HOSTS.has(parsed.hostname)) {
    throw new Error('Discord CDN 첨부 파일 URL만 허용됩니다.');
  }
}

export function sanitizeFilename(name: string): string {
  const sanitized = name
    .replace(/[\\/]/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return sanitized.length > 0 ? sanitized.slice(0, 120) : 'attachment';
}
