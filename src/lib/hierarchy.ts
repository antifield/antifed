import type { GuildMember } from "discord.js";

export function canModerate(moderator: GuildMember, target: GuildMember): boolean {
  if (moderator.id === target.id) return false;
  if (target.id === moderator.guild.ownerId) return false;
  if (target.id === moderator.guild.members.me?.id) return false;
  return moderator.roles.highest.position > target.roles.highest.position;
}

export function formatHierarchyError(target: GuildMember): string {
  return `Cannot moderate **${target.user.username}** - their role is equal to or higher than yours.`;
}
