import { describe, expect, it } from 'vitest';
import { buildCdbCommand } from '../src/bot/commands/index.js';

interface CommandOption {
  name: string;
  type: number;
  options?: CommandOption[];
  choices?: Array<{ name: string; value: string }>;
}

function subcommand(name: string): CommandOption {
  const cmd = buildCdbCommand().toJSON();
  const options = (cmd.options ?? []) as CommandOption[];
  const found = options.find((o) => o.name === name);
  if (!found) throw new Error(`missing subcommand ${name}`);
  return found;
}

describe('/cdb command schema', () => {
  it('registers the feature commands needed for Discord session control', () => {
    const names = ((buildCdbCommand().toJSON().options ?? []) as CommandOption[]).map((o) => o.name);
    expect(names).toEqual([
      'status',
      'init',
      'browse',
      'new',
      'resume',
      'model',
      'stop',
      'close',
      'usage',
      'plugin',
      'config',
      'clear',
    ]);
  });

  it('allows choosing permission mode when browsing or creating sessions', () => {
    const browse = subcommand('browse').options ?? [];
    const newCommand = subcommand('new').options ?? [];
    const browseOptions = browse.map((o) => o.name);
    const newOptions = newCommand.map((o) => o.name);

    expect(browseOptions).toContain('permission_mode');
    expect(newOptions).toContain('permission_mode');
    const browsePermission = browse.find((o) => o.name === 'permission_mode');
    const newPermission = newCommand.find((o) => o.name === 'permission_mode');
    expect(browsePermission?.choices?.map((o) => o.value)).not.toContain('bypassPermissions');
    expect(newPermission?.choices?.map((o) => o.value)).not.toContain('bypassPermissions');
  });

});
