import type { SubCommand } from '../types.js';

interface StubOpts {
  name: string;
  description: string;
  milestone: string;
  build?: (sub: import('discord.js').SlashCommandSubcommandBuilder) => import('discord.js').SlashCommandSubcommandBuilder;
}

export function makeStub(opts: StubOpts): SubCommand {
  return {
    name: opts.name,
    build: (sub) => {
      const b = sub.setName(opts.name).setDescription(opts.description);
      return opts.build ? opts.build(b) : b;
    },
    async handle(interaction) {
      await interaction.reply({
        content: `⏳ \`/cdb ${opts.name}\` 은 ${opts.milestone} 단계에서 구현됩니다.`,
        ephemeral: true,
      });
    },
  };
}
