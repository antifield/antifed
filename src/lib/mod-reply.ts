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
  await interaction.editReply({ embeds: [embeds.reply] });
  await sendModLog(guild, embeds.log ?? embeds.reply);
}
