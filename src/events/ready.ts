import { Events } from "discord.js";
import { log } from "~/lib/logger";
import type { Event } from "~/types";

export default {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    log.info("ready", `Logged in as ${client.user.tag}`);
  },
} satisfies Event<Events.ClientReady>;
