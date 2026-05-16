/* Manual integration probe (not run by vitest).
 *   tsx test/fixtures/integration-runner.ts
 * Uses the real `claude` binary. Costs API tokens. */
import { ClaudeRunner } from '../../src/claude/runner.js';
import { tmpdir } from 'node:os';

async function main(): Promise<void> {
  const r = new ClaudeRunner({
    bin: 'claude',
    cwd: tmpdir(),
    model: 'sonnet',
    initialPrompt: 'reply with the single word: pong',
  });
  let text = '';
  let sessionId: string | null = null;
  r.on('init', (s) => {
    sessionId = s.session_id;
    process.stdout.write(`[init] session=${s.session_id} model=${s.model}\n`);
  });
  r.on('text', (t) => {
    text += t;
    process.stdout.write(`[text] ${JSON.stringify(t)}\n`);
  });
  r.on('usage', (u) => process.stdout.write(`[usage] ${JSON.stringify(u)}\n`));
  r.on('error', (e) => process.stderr.write(`[err] ${e.message}\n`));
  r.on('end', (final) => {
    process.stdout.write(`[end] ${final.subtype} cost=${final.total_cost_usd}\n`);
    r.endInput();
  });
  r.on('exit', (code) => {
    const ok = code === 0 && /pong/i.test(text) && sessionId !== null;
    process.stdout.write(`[exit] code=${code} ok=${ok}\n`);
    process.exit(ok ? 0 : 1);
  });
  await r.start();
}
main().catch((e: unknown) => {
  process.stderr.write(`fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
