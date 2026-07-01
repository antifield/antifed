import type { ChatInputCommandInteraction, EmbedBuilder, Guild } from "discord.js";
import { sendModLog } from "~/lib/mod-log";

// Sends a command's result embed back to the invoker and mirrors it to the
// mod-log channel. Pass a distinct `log` embed when the public reply should
// differ from the logged copy (e.g. a silent action that hides the moderator);
// otherwise the reply embed is logged as-is.
export async function replyAndLog(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  embeds: { reply: EmbedBuilder; log?: EmbedBuilder },
): Promise<void> {
  // The mod-log is the durable audit record, so it must fire even when the
  // reply fails (e.g. an expired interaction token after a slow action). The
  // reply error still propagates; sendModLog catches its own errors internally.
  try {
    await interaction.editReply({ embeds: [embeds.reply] });
  } finally {
    await sendModLog(guild, embeds.log ?? embeds.reply);
  }
}
