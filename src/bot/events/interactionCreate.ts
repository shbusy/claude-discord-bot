import { Events, type Interaction } from 'discord.js';
import type { AppContext } from '../types.js';
import { dispatch } from '../commands/index.js';
import { handleDirectoryBrowserInteraction } from '../../ui/directoryBrowser.js';

export function registerInteractions(ctx: AppContext): void {
  ctx.client.on(Events.InteractionCreate, (interaction: Interaction) => {
    if (interaction.isChatInputCommand()) {
      void dispatch(interaction, ctx);
      return;
    }
    if (interaction.isStringSelectMenu() || interaction.isButton() || interaction.isModalSubmit()) {
      void handleDirectoryBrowserInteraction(interaction, ctx).catch((err) =>
        ctx.log.error({ err }, '컴포넌트 처리 실패'),
      );
      return;
    }
  });
}
