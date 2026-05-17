import { EmbedBuilder } from 'discord.js';
import type { SubCommand } from '../types.js';

export const pluginCommand: SubCommand = {
  name: 'plugin',
  build: (sub) =>
    sub
      .setName('plugin')
      .setDescription('플러그인 관리')
      .addStringOption((o) =>
        o
          .setName('action')
          .setDescription('동작')
          .addChoices(
            { name: 'list', value: 'list' },
            { name: 'reload', value: 'reload' },
            { name: 'enable', value: 'enable' },
            { name: 'disable', value: 'disable' },
          )
          .setRequired(true),
      )
      .addStringOption((o) => o.setName('name').setDescription('플러그인 이름').setRequired(false)),
  async handle(interaction, ctx) {
    const action = interaction.options.getString('action', true);

    if (action === 'list') {
      const plugins = ctx.pluginRegistry?.list() ?? [];
      if (plugins.length === 0) {
        await interaction.reply({ content: '로드된 플러그인이 없습니다.', ephemeral: true });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle('🔌 플러그인 목록')
        .setColor(0x5865f2)
        .setDescription(
          plugins.map((p) => `• **${p.name}** v${p.version}`).join('\n'),
        );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (action === 'reload') {
      if (ctx.pluginLoader) {
        await ctx.pluginLoader.loadAll();
        await interaction.reply({ content: '✅ 플러그인을 다시 로드했습니다.', ephemeral: true });
      } else {
        await interaction.reply({ content: '플러그인 로더가 초기화되지 않았습니다.', ephemeral: true });
      }
      return;
    }

    const name = interaction.options.getString('name');
    if (!name) {
      await interaction.reply({ content: `\`${action}\`에는 플러그인 이름이 필요합니다.`, ephemeral: true });
      return;
    }

    if (action === 'disable') {
      await ctx.pluginRegistry?.unregister(name);
      await interaction.reply({ content: `✅ \`${name}\` 플러그인을 비활성화했습니다.`, ephemeral: true });
      return;
    }

    if (action === 'enable') {
      const loaded = await ctx.pluginLoader?.loadNamed(name);
      await interaction.reply({
        content: loaded ? `✅ \`${name}\` 플러그인을 활성화했습니다.` : `플러그인 파일을 찾을 수 없습니다: \`${name}\``,
        ephemeral: true,
      });
    }
  },
};
