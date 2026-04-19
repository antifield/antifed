import { EmbedBuilder, type User } from "discord.js";
import { Colors } from "~/lib/constants";

interface ModEmbedOptions {
  title: string;
  description: string;
  color: number;
  moderator?: User;
  target?: User;
  fields?: { name: string; value: string; inline?: boolean }[];
}

export function modEmbed(options: ModEmbedOptions): EmbedBuilder {
  const lines = [options.description];

  if (options.fields) {
    lines.push("");
    for (const field of options.fields) {
      lines.push(`**${field.name}:** ${field.value}`);
    }
  }

  const embed = new EmbedBuilder()
    .setAuthor({ name: options.title })
    .setDescription(lines.join("\n"))
    .setColor(options.color)
    .setTimestamp();

  if (options.moderator) {
    embed.setFooter({
      text: options.moderator.username,
      iconURL: options.moderator.displayAvatarURL(),
    });
  }

  if (options.target) {
    embed.setThumbnail(options.target.displayAvatarURL());
  }

  return embed;
}

export function dmEmbed(options: {
  title: string;
  description: string;
  color: number;
  serverName: string;
  fields?: { name: string; value: string; inline?: boolean }[];
}): EmbedBuilder {
  const lines = [options.description];

  if (options.fields) {
    lines.push("");
    for (const field of options.fields) {
      lines.push(`**${field.name}:** ${field.value}`);
    }
  }

  return new EmbedBuilder()
    .setAuthor({ name: options.title })
    .setDescription(lines.join("\n"))
    .setColor(options.color)
    .setFooter({ text: options.serverName })
    .setTimestamp();
}

export function errorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder().setDescription(message).setColor(Colors.Error).setTimestamp();
}

export function successEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder().setDescription(message).setColor(Colors.Success).setTimestamp();
}

export function infoEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder().setDescription(message).setColor(Colors.Info).setTimestamp();
}
