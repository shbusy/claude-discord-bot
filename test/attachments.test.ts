import { describe, expect, it } from 'vitest';
import {
  extractOutputFilePath,
  formatAttachmentsForPrompt,
  sanitizeFilename,
  shouldAttachOutputFile,
  validateAttachmentUrl,
} from '../src/util/attachments.js';

describe('attachment utilities', () => {
  it('sanitizes filenames before writing Discord attachments to disk', () => {
    expect(sanitizeFilename('../secret.txt')).toBe('..-secret.txt');
    expect(sanitizeFilename('nested/path\\file.png')).toBe('nested-path-file.png');
    expect(sanitizeFilename('\u0000')).toBe('attachment');
  });

  it('formats saved local attachment paths for Claude', () => {
    expect(formatAttachmentsForPrompt([{
      name: 'log.txt',
      url: 'https://cdn.discordapp.com/log.txt',
      contentType: 'text/plain',
      size: 12,
      filePath: '/tmp/cdb/log.txt',
    }])).toContain('/tmp/cdb/log.txt');
  });

  it('extracts Claude Write output paths for Discord upload', () => {
    expect(extractOutputFilePath('Write', { file_path: 'out/report.txt' }, '/work')).toBe('/work/out/report.txt');
    expect(extractOutputFilePath('Read', { file_path: 'out/report.txt' }, '/work')).toBeNull();
  });

  it('only attaches files inside the session cwd', () => {
    expect(shouldAttachOutputFile('/work/out/report.txt', '/work')).toBe(true);
    expect(shouldAttachOutputFile('/work-other/out/report.txt', '/work')).toBe(false);
    expect(shouldAttachOutputFile('/etc/passwd', '/work')).toBe(false);
  });

  it('only accepts Discord CDN HTTPS attachment URLs', () => {
    expect(() => validateAttachmentUrl('https://cdn.discordapp.com/attachments/a/b/file.txt')).not.toThrow();
    expect(() => validateAttachmentUrl('https://media.discordapp.net/attachments/a/b/file.txt')).not.toThrow();
    expect(() => validateAttachmentUrl('http://cdn.discordapp.com/attachments/a/b/file.txt')).toThrow();
    expect(() => validateAttachmentUrl('https://example.com/file.txt')).toThrow();
  });
});
