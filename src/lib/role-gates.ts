import type { ChatInputCommandInteraction, GuildMember } from "discord.js";
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

// Staff check for contexts that hold a GuildMember rather than an interaction,
// such as the messageCreate handler. A null member (uncached) is treated as
// non-staff so it never short-circuits an automated action.
export function memberHasStaffRole(member: GuildMember | null | undefined): boolean {
  if (!member) return false;
  const staffRoleIds = [env.MODERATOR_ROLE_ID, env.BOT_DEVELOPER_ROLE_ID];
  return staffRoleIds.some((roleId) => roleId !== undefined && member.roles.cache.has(roleId));
}

export const roleCheckers = {
  staff: hasStaffRole,
  dev: hasDevRole,
  page: hasPageRole,
} as const;

export type RoleRequirement = keyof typeof roleCheckers;
