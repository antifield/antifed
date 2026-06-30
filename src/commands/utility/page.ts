import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import { env } from "~/env";
import { Colors } from "~/lib/constants";
import { errorEmbed, successEmbed } from "~/lib/embeds";
import { formatError } from "~/lib/errors";
import { useInteractionLog } from "~/lib/log-context";
import { log } from "~/lib/logger";
import { sendModLog } from "~/lib/mod-log";
import type { Command } from "~/types";

const PAGE_FETCH_TIMEOUT_MS = 10_000;
const BETTERSTACK_INCIDENTS_URL = "https://uptime.betterstack.com/api/v2/incidents";
const COOLDOWN_MS = 60_000;

const cooldowns = new Map<string, number>();

function cooldownRemainingMs(userId: string): number {
  const expiresAt = cooldowns.get(userId);
  if (!expiresAt) return 0;
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) {
    cooldowns.delete(userId);
    return 0;
  }
  return remaining;
}

export default {
  data: new SlashCommandBuilder()
    .setName("page")
    .setDescription("Page the on-call team via Better Stack.")
    .addStringOption((o) =>
      o.setName("reason").setDescription("Why you're paging on-call").setRequired(true),
    )
    .addBooleanOption((o) =>
      o.setName("critical").setDescription("Bypass Do Not Disturb on iOS (emergencies only)"),
    ),

  requiredRole: "page",

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const eventLog = useInteractionLog();

    if (!env.BETTERSTACK_API_TOKEN || !env.BETTERSTACK_REQUESTER_EMAIL) {
      // Paging is optional — env is valid without these — but a staffer hitting
      // this branch means they expected to page and the bot can't. Surface it.
      eventLog?.set({ outcome: "disabled", reason: "betterstack_not_configured" });
      log.warn({
        action: "page",
        status: "disabled",
        user_id: interaction.user.id,
        reason: "BETTERSTACK_API_TOKEN or BETTERSTACK_REQUESTER_EMAIL is unset",
      });
      await interaction.editReply({
        embeds: [errorEmbed("Better Stack is not configured.")],
      });
      return;
    }

    const remaining = cooldownRemainingMs(interaction.user.id);
    if (remaining > 0) {
      eventLog?.set({ outcome: "cooldown", cooldown_remaining_ms: remaining });
      await interaction.editReply({
        embeds: [errorEmbed(`On cooldown. Try again in ${Math.ceil(remaining / 1000)}s.`)],
      });
      return;
    }

    const reason = interaction.options.getString("reason", true);
    const critical = interaction.options.getBoolean("critical") ?? false;
    const channelUrl =
      interaction.guildId && interaction.channelId
        ? `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}`
        : null;

    eventLog?.set({ critical, reason_length: reason.length });

    const descriptionParts = [
      `Paged by ${interaction.user.username} (${interaction.user.id}) in ${interaction.guild?.name ?? "Unknown"}`,
    ];
    if (channelUrl) descriptionParts.push(`Channel: ${channelUrl}`);

    try {
      const response = await fetch(BETTERSTACK_INCIDENTS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.BETTERSTACK_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requester_email: env.BETTERSTACK_REQUESTER_EMAIL,
          name: `[antifed] ${reason}`.slice(0, 255),
          summary: reason,
          description: descriptionParts.join("\n"),
          call: true,
          sms: true,
          push: true,
          email: false,
          critical_alert: critical,
        }),
        signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        const body = await response.text();
        log.error({
          action: "page",
          status: "betterstack_error",
          http_status: response.status,
          response_body: body.slice(0, 200),
        });
        eventLog?.set({ outcome: "error", http_status: response.status });
        await interaction.editReply({
          embeds: [errorEmbed(`Failed to page: ${response.status} ${response.statusText}`)],
        });
        return;
      }

      cooldowns.set(interaction.user.id, Date.now() + COOLDOWN_MS);
      eventLog?.set({ outcome: "ok", http_status: response.status });

      const channels = critical ? "call, SMS, push, critical alert" : "call, SMS, push";
      await interaction.editReply({
        embeds: [successEmbed(`On-call paged via **${channels}**.\n\n> ${reason}`)],
      });

      if (interaction.guild) {
        const logEmbed = new EmbedBuilder()
          .setAuthor({ name: "On-call paged" })
          .setDescription(`> ${reason}`)
          .addFields(
            { name: "Channels", value: channels, inline: true },
            { name: "Critical", value: critical ? "Yes" : "No", inline: true },
          )
          .setColor(critical ? Colors.Error : Colors.Info)
          .setFooter({
            text: interaction.user.username,
            iconURL: interaction.user.displayAvatarURL(),
          })
          .setTimestamp();

        if (channelUrl) {
          logEmbed.addFields({ name: "Origin", value: channelUrl, inline: false });
        }

        await sendModLog(interaction.guild, logEmbed);
      }
    } catch (err) {
      log.error({
        action: "page",
        status: "fetch_error",
        error: formatError(err),
      });
      eventLog?.set({ outcome: "error", reason: "fetch_error" });
      await interaction.editReply({
        embeds: [errorEmbed("Failed to reach Better Stack.")],
      });
    }
  },
} satisfies Command;
