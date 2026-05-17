import type { SubCommand } from '../types.js';
import { showDirectoryBrowser } from '../../ui/directoryBrowser.js';

export const browseCommand: SubCommand = {
  name: 'browse',
  build: (sub) =>
    sub
      .setName('browse')
      .setDescription('Discord 셀렉트 메뉴로 작업 폴더 선택')
      .addStringOption((o) => o.setName('path').setDescription('시작 경로').setRequired(false))
      .addStringOption((o) =>
        o
          .setName('permission_mode')
          .setDescription('권한 모드')
          .addChoices(
            { name: 'default', value: 'default' },
            { name: 'acceptEdits', value: 'acceptEdits' },
            { name: 'auto', value: 'auto' },
            { name: 'dontAsk', value: 'dontAsk' },
            { name: 'plan', value: 'plan' },
          )
          .setRequired(false),
      ),
  async handle(interaction, ctx) {
    await showDirectoryBrowser(
      interaction,
      ctx,
      interaction.options.getString('path'),
      interaction.options.getString('permission_mode') ?? ctx.config.permissionMode,
    );
  },
};
