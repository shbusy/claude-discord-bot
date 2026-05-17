import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existingFiles } from '../src/ui/threadRouter.js';

describe('ThreadRouter file attachments', () => {
  it('keeps readable files and drops missing files before Discord upload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cdb-thread-'));
    const file = join(dir, 'out.txt');
    await writeFile(file, 'ok');

    await expect(existingFiles([file, join(dir, 'missing.txt')])).resolves.toEqual([file]);
  });
});
