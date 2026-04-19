import type {
  ChatInputCommandInteraction,
  ClientEvents,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";
import type { RoleRequirement } from "~/lib/role-gates";

export interface Command {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  requiredRole?: RoleRequirement;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export interface Event<
  K extends keyof ClientEvents = keyof ClientEvents,
  Extras extends unknown[] = [],
> {
  name: K;
  once?: boolean;
  execute: (...args: [...ClientEvents[K], ...Extras]) => unknown;
}
