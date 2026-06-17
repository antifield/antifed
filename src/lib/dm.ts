import type { EmbedBuilder, User } from "discord.js";
import { formatError } from "~/lib/errors";
import { log } from "~/lib/logger";

// Best effort DM used by moderation actions. A throw here is almost always the
// recipient having DMs closed (discord.js retries rate limits internally), so
// callers proceed regardless of the result. The failure is logged in one place
// instead of being swallowed, and the boolean tells the caller whether to note
// "could not DM" back to the moderator.
export async function trySendDm(user: User, embed: EmbedBuilder): Promise<boolean> {
  try {
    await user.send({ embeds: [embed] });
    return true;
  } catch (err) {
    log.warn({
      action: "dm",
      status: "failed",
      targetId: user.id,
      error: formatError(err),
    });
    return false;
  }
}
