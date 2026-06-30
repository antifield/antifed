import { ActivityType, type Client, Events } from "discord.js";
import { env } from "~/env";
import { formatError } from "~/lib/errors";
import { log } from "~/lib/logger";
import type { Event } from "~/types";

// How often the "Watching N members" presence is refreshed.
const PRESENCE_REFRESH_MS = 30 * 60_000;

// Sets the bot's presence to e.g. "Watching 6,700 members" from the configured
// guild's member count. Exported so it can be unit-tested without a real client.
export function setMemberCountPresence(client: Client<true>): void {
  const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID);
  if (!guild) {
    log.warn({ action: "presence", status: "guild_uncached", guildId: env.DISCORD_GUILD_ID });
    return;
  }

  client.user.setActivity(`${guild.memberCount.toLocaleString("en-US")} members`, {
    type: ActivityType.Watching,
  });
}

export default {
  name: Events.ClientReady,
  once: true,
  execute(client: Client<true>) {
    // Guard both the initial set and the refresh so a transient failure can never
    // escape to the process-wide uncaughtException handler and kill the bot.
    const refresh = () => {
      try {
        setMemberCountPresence(client);
      } catch (err) {
        log.error({ action: "presence", status: "refresh_failed", error: formatError(err) });
      }
    };
    refresh();
    setInterval(refresh, PRESENCE_REFRESH_MS);
  },
} satisfies Event<Events.ClientReady>;
