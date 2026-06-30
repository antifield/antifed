import { Collection, Events, type Interaction, MessageFlags } from "discord.js";
import { errorEmbed } from "~/lib/embeds";
import { formatError } from "~/lib/errors";
import { withInteractionLog } from "~/lib/log-context";
import { log } from "~/lib/logger";
import { roleCheckers } from "~/lib/role-gates";
import type { Command, Event } from "~/types";

export default {
  name: Events.InteractionCreate,
  once: false,
  async execute(interaction: Interaction, commands: Collection<string, Command>) {
    if (!interaction.isChatInputCommand()) return;

    const command = commands.get(interaction.commandName);
    if (!command) return;

    await withInteractionLog(
      {
        action: "interaction",
        command: interaction.commandName,
        user_id: interaction.user.id,
        guild_id: interaction.guildId,
        channel_id: interaction.channelId,
      },
      async (eventLog) => {
        if (command.requiredRole && !roleCheckers[command.requiredRole](interaction)) {
          eventLog.set({ outcome: "denied", reason: "missing_role" });
          await interaction.reply({
            embeds: [errorEmbed("You don't have permission to use this command.")],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        try {
          await command.execute(interaction);
          eventLog.set({ outcome: "ok" });
        } catch (err) {
          const errorInstance = err instanceof Error ? err : new Error(String(err));
          eventLog.error(errorInstance, { step: "execute" });
          eventLog.set({ outcome: "error" });
          log.error(
            "command",
            `Error in /${interaction.commandName}: ${errorInstance.stack ?? errorInstance.message}`,
          );
          await replyError(interaction);
        }
      },
    );
  },
} satisfies Event<Events.InteractionCreate, [Collection<string, Command>]>;

async function replyError(interaction: Interaction & { replied: boolean; deferred: boolean }) {
  // Best-effort: if the fallback send itself fails (expired token, Discord outage),
  // swallow so it doesn't escalate to unhandledRejection.
  try {
    const embeds = [errorEmbed("Something went wrong executing this command.")];
    if (!interaction.isChatInputCommand()) return;
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ embeds, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ embeds, flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    log.error("command-reply", `Failed to send error response: ${formatError(err)}`);
  }
}
