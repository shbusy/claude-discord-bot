import { describe, expect, it } from 'vitest';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { buildCategoryOverwrites, channelNameMatches } from '../src/bot/commands/init.js';
import {
  GENERAL_CATEGORY_NAMES,
  PRIMARY_BROWSER_CHANNEL_NAME,
  PRIMARY_GENERAL_CATEGORY_NAME,
  PRIMARY_SESSIONS_CATEGORY_NAME,
  PRIMARY_USAGE_CHANNEL_NAME,
  SESSIONS_CATEGORY_NAMES,
} from '../src/bot/channelNames.js';

describe('/a4d init channel naming', () => {
  it('matches the primary category and channel names', () => {
    expect(PRIMARY_GENERAL_CATEGORY_NAME).toBe('General');
    expect(PRIMARY_SESSIONS_CATEGORY_NAME).toBe('Sessions');
    expect(PRIMARY_BROWSER_CHANNEL_NAME).toBe('session');
    expect(PRIMARY_USAGE_CHANNEL_NAME).toBe('usage');
  });

  it('accepts both A4D and legacy category names while searching existing channels', () => {
    expect(channelNameMatches(
      { type: ChannelType.GuildCategory, name: 'A4D - Sessions' } as never,
      ChannelType.GuildCategory,
      SESSIONS_CATEGORY_NAMES,
    )).toBe(true);
    expect(channelNameMatches(
      { type: ChannelType.GuildCategory, name: '📁 Sessions' } as never,
      ChannelType.GuildCategory,
      SESSIONS_CATEGORY_NAMES,
    )).toBe(true);
    expect(channelNameMatches(
      { type: ChannelType.GuildCategory, name: 'A4D - General' } as never,
      ChannelType.GuildCategory,
      GENERAL_CATEGORY_NAMES,
    )).toBe(true);
  });

  it('allows the bot and users to use threads, attachments, history, and reactions in session categories', () => {
    const overwrites = buildCategoryOverwrites('guild', 'bot', ['user']);
    const bot = overwrites.find((o) => o.id === 'bot')!;
    const user = overwrites.find((o) => o.id === 'user')!;

    for (const target of [bot, user]) {
      expect(target.allow).toEqual(expect.arrayContaining([
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AddReactions,
      ]));
    }
    expect(bot.allow).toContain(PermissionFlagsBits.ManageThreads);
  });
});
