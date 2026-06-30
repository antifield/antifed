import { type EmbedBuilder, type Guild, TextChannel } from "discord.js";
import { env } from "~/env";
import { formatError } from "~/lib/errors";
import { log } from "~/lib/logger";

export async function sendModLog(guild: Guild, embed: EmbedBuilder): Promise<void> {
  if (!env.LOG_CHANNEL_ID) return;

  try {
    const channel = await guild.channels.fetch(env.LOG_CHANNEL_ID);
    if (channel instanceof TextChannel) {
      await channel.send({ embeds: [embed] });
      return;
    }
    // Silently dropping here is how mis-configured log channels (forum, voice,
    // thread) go undetected for weeks. Surface the mismatch with the resolved type.
    log.warn({
      action: "mod-log",
      status: "channel_not_text",
      channel_id: env.LOG_CHANNEL_ID,
      resolved_type: channel?.type ?? "null",
    });
  } catch (err) {
    log.warn({
      action: "mod-log",
      status: "fetch_failed",
      channel_id: env.LOG_CHANNEL_ID,
      error: formatError(err),
    });
  }
}
