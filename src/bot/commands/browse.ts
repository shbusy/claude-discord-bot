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
            { name: 'bypassPermissions (완전 자동)', value: 'bypassPermissions' },
            { name: 'auto (분류기 기반 자동)', value: 'auto' },
            { name: 'acceptEdits (편집만 자동)', value: 'acceptEdits' },
            { name: 'default (매번 확인)', value: 'default' },
            { name: 'plan (툴 실행 없음)', value: 'plan' },
          )
          .setRequired(false),
      ),
  async handle(interaction, ctx) {
    await showDirectoryBrowser(
      interaction,
      ctx,
      interaction.options.getString('path'),
      interaction.options.getString('permission_mode') ?? undefined,
    );
  },
};
