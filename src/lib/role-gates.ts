import type { ChatInputCommandInteraction } from "discord.js";
import { env } from "~/env";

function hasRoleId(interaction: ChatInputCommandInteraction, roleId: string | undefined): boolean {
  if (!roleId) return false;
  const member = interaction.member;
  if (!member || !("cache" in member.roles)) return false;
  return member.roles.cache.has(roleId);
}

export function hasDevRole(interaction: ChatInputCommandInteraction): boolean {
  return hasRoleId(interaction, env.BOT_DEVELOPER_ROLE_ID);
}

export function hasModRole(interaction: ChatInputCommandInteraction): boolean {
  return hasRoleId(interaction, env.MODERATOR_ROLE_ID);
}

export function hasStaffRole(interaction: ChatInputCommandInteraction): boolean {
  return hasModRole(interaction) || hasDevRole(interaction);
}

export function hasPageRole(interaction: ChatInputCommandInteraction): boolean {
  return hasRoleId(interaction, env.PAGE_ROLE_ID);
}

export const roleCheckers = {
  staff: hasStaffRole,
  dev: hasDevRole,
  page: hasPageRole,
} as const;

export type RoleRequirement = keyof typeof roleCheckers;
