import { describe, expect, it } from 'vitest';
import { autoAllowSafeTool, buildPermissionButtonRow, formatInputPreview } from '../src/ui/permissionPrompt.js';

describe('permission prompt', () => {
  it('auto-allows safe read-only tools once', () => {
    expect(autoAllowSafeTool({
      type: 'permission_request',
      id: 'req-1',
      session_id: 's',
      tool: { name: 'Read', input: { file_path: 'README.md' } },
    })).toEqual({ type: 'permission_decision', id: 'req-1', decision: 'allow_once' });
  });

  it('does not auto-allow mutating tools', () => {
    expect(autoAllowSafeTool({
      type: 'permission_request',
      id: 'req-2',
      session_id: 's',
      tool: { name: 'Bash', input: { command: 'npm install' } },
    })).toBeNull();
  });

  it('caps input preview to 3 lines and notes the rest', () => {
    const preview = formatInputPreview({ a: 1, b: 2, c: 3, d: 4, e: 5 });
    const lines = preview.split('\n');
    expect(lines.length).toBe(4);
    expect(lines[3]).toMatch(/^… \(\+\d+ more\)$/);
  });

  it('truncates very long single lines in input preview', () => {
    const long = 'x'.repeat(500);
    const preview = formatInputPreview({ command: long });
    for (const line of preview.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(121);
    }
    expect(preview).toContain('…');
  });

  it('orders permission buttons as allow once, always allow, deny', () => {
    const row = buildPermissionButtonRow('req-3').toJSON();
    const components = row.components as Array<{ label?: string; custom_id?: string }>;
    const labels = components.map((c) => c.label);
    const ids = components.map((c) => c.custom_id);

    expect(labels).toEqual(['한 번만 허용', '항상 허용', '거부']);
    expect(ids).toEqual(['perm_once_req-3', 'perm_allow_req-3', 'perm_deny_req-3']);
  });
});
