import { Client, Collection, Events, GatewayIntentBits, REST, Routes } from "discord.js";
import { env } from "~/env";
import { formatError } from "~/lib/errors";
import { log } from "~/lib/logger";
import type { Command, Event } from "~/types";
import { Glob } from "bun";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

const commands = new Collection<string, Command>();

async function loadCommands(): Promise<void> {
  const glob = new Glob("**/*.ts");
  const commandsDir = `${import.meta.dir}/commands`;

  for await (const file of glob.scan(commandsDir)) {
    const mod = (await import(`${commandsDir}/${file}`)) as { default: Command };
    const command = mod.default;

    if (!command?.data || !command?.execute) {
      log.warn("commands", `Skipping ${file} - missing data or execute`);
      continue;
    }

    commands.set(command.data.name, command);
  }

  log.info("commands", `Loaded ${commands.size} commands`);
}

async function loadEvents(): Promise<void> {
  const glob = new Glob("**/*.ts");
  const eventsDir = `${import.meta.dir}/events`;
  let count = 0;

  for await (const file of glob.scan(eventsDir)) {
    const mod = (await import(`${eventsDir}/${file}`)) as { default: Event };
    const event = mod.default;

    if (!event?.name || !event?.execute) {
      log.warn("events", `Skipping ${file} - missing name or execute`);
      continue;
    }

    const dispatch = (...args: unknown[]) =>
      (event.execute as (...a: unknown[]) => unknown)(...args, commands);
    if (event.once) {
      client.once(event.name, dispatch);
    } else {
      client.on(event.name, dispatch);
    }

    count++;
  }

  log.info("events", `Loaded ${count} events`);
}

async function registerSlashCommands(): Promise<void> {
  const rest = new REST().setToken(env.DISCORD_TOKEN);
  const commandData = commands.map((cmd) => cmd.data.toJSON());

  await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), {
    body: commandData,
  });

  log.info("commands", `Registered ${commandData.length} slash commands`);
}

async function main(): Promise<void> {
  await loadCommands();
  await loadEvents();

  client.once(Events.ClientReady, async () => {
    try {
      await registerSlashCommands();
    } catch (err) {
      // Registration is a one-shot at startup; if Discord rejects (rate limit, bad token,
      // outage) we log and exit so the supervisor can retry with backoff. Staying up
      // with stale or no commands registered would silently break every interaction.
      log.error("commands-register", `Failed to register slash commands: ${formatError(err)}`);
      process.exit(1);
    }
  });

  await client.login(env.DISCORD_TOKEN);
}

process.on("unhandledRejection", (reason) => {
  log.error("unhandledRejection", formatError(reason));
});

process.on("uncaughtException", (err) => {
  // Node docs: after an uncaughtException the process is in an undefined state.
  // Log for post-mortem, then exit so the supervisor restarts us.
  log.error("uncaughtException", err.stack ?? err.message);
  process.exit(1);
});

main().catch((err) => {
  log.error("fatal", formatError(err));
  process.exit(1);
});
