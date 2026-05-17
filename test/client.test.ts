import { describe, expect, it } from 'vitest';
import { GatewayIntentBits } from 'discord.js';
import { createClient } from '../src/bot/client.js';

describe('Discord client intents', () => {
  it('requests message content and thread-capable guild message intents', () => {
    const client = createClient();
    const intents = client.options.intents;

    expect(intents.has(GatewayIntentBits.Guilds)).toBe(true);
    expect(intents.has(GatewayIntentBits.GuildMessages)).toBe(true);
    expect(intents.has(GatewayIntentBits.MessageContent)).toBe(true);
    expect(intents.has(GatewayIntentBits.DirectMessages)).toBe(true);
  });
});
