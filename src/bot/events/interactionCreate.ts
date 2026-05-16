import { Events, type Interaction } from 'discord.js';
import type { AppContext } from '../types.js';
import { dispatch } from '../commands/index.js';

export function registerInteractions(ctx: AppContext): void {
  ctx.client.on(Events.InteractionCreate, (interaction: Interaction) => {
    if (interaction.isChatInputCommand()) {
      void dispatch(interaction, ctx);
      return;
    }
  });
}
