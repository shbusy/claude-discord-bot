import { access, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { resolve } from 'node:path';
import { PermissionFlagsBits } from 'discord.js';

export interface SetupAnswers {
  discordToken: string;
  discordClientId: string;
  allowedUserIds: string;
  discordGuildId?: string;
  defaultModel: string;
  permissionMode: string;
  defaultCwd?: string;
}

export async function runSetup(envPath = resolve(process.cwd(), '.env')): Promise<void> {
  const exists = await fileExists(envPath);
  if (exists) {
    output.write(`.env already exists at ${envPath}\n`);
    output.write('Delete or edit it manually if you want to regenerate it.\n');
    return;
  }

  const rl = createInterface({ input, output });
  try {
    const answers: SetupAnswers = {
      discordToken: await rl.question('Discord bot token: '),
      discordClientId: await rl.question('Discord client/application ID: '),
      allowedUserIds: await rl.question('Allowed Discord user IDs (comma-separated): '),
      discordGuildId: await optionalQuestion(rl, 'Development guild ID (optional): '),
      defaultModel: (await optionalQuestion(rl, 'Default model [sonnet]: ')) || 'sonnet',
      permissionMode: (await optionalQuestion(rl, 'Permission mode [default]: ')) || 'default',
      defaultCwd: await optionalQuestion(rl, 'Default working directory (optional): '),
    };
    await writeFile(envPath, renderEnv(answers), { mode: 0o600 });
    output.write(`Wrote ${envPath}\n`);
    output.write(`Invite URL: ${buildInviteUrl(answers.discordClientId)}\n`);
    output.write(`${nextSteps()}\n`);
  } finally {
    rl.close();
  }
}

export function buildInviteUrl(clientId: string): string {
  const permissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.UseApplicationCommands,
    PermissionFlagsBits.ManageThreads,
    PermissionFlagsBits.ManageChannels,
  ].reduce((acc, bit) => acc | bit, 0n);
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'bot applications.commands',
    permissions: permissions.toString(),
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export function nextSteps(): string {
  return 'Next: npm run doctor && npm run register && npm run run:bot';
}

export function renderEnv(a: SetupAnswers): string {
  return [
    `DISCORD_TOKEN=${a.discordToken}`,
    `DISCORD_CLIENT_ID=${a.discordClientId}`,
    `DISCORD_GUILD_ID=${a.discordGuildId ?? ''}`,
    `ALLOWED_USER_IDS=${a.allowedUserIds}`,
    '',
    'CLAUDE_BIN=claude',
    `DEFAULT_MODEL=${a.defaultModel}`,
    `PERMISSION_MODE=${a.permissionMode}`,
    'DEFAULT_LANG=ko',
    `DEFAULT_CWD=${a.defaultCwd ?? ''}`,
    'IDLE_TIMEOUT_MS=3300000',
    '',
    'CDB_HOME=',
    'LOG_LEVEL=info',
    '',
  ].join('\n');
}

async function optionalQuestion(rl: ReturnType<typeof createInterface>, question: string): Promise<string | undefined> {
  const value = (await rl.question(question)).trim();
  return value.length > 0 ? value : undefined;
}

async function fileExists(path: string): Promise<boolean> {
  return access(path, constants.F_OK).then(() => true, () => false);
}
