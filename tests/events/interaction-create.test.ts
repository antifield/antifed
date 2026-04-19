import { describe, expect, mock, test } from "bun:test";
import { Collection } from "discord.js";
import { env } from "../../src/env";

const { default: interactionCreate } = await import("../../src/events/interaction-create");
import type { Command } from "../../src/types";

// Use the resolved env values so tests work both locally (with .env populated)
// and in CI (where the workflow injects test-token values).
const DEV_ROLE = env.BOT_DEVELOPER_ROLE_ID;

type FakeInteraction = {
  isChatInputCommand: () => boolean;
  commandName: string;
  user: { id: string };
  guildId: string | null;
  channelId: string | null;
  member: { roles: { cache: Collection<string, { id: string }> } } | null;
  replied: boolean;
  deferred: boolean;
  reply: ReturnType<typeof mock>;
  followUp: ReturnType<typeof mock>;
};

function makeInteraction(opts: {
  commandName: string;
  roleIds?: string[];
  isChatInput?: boolean;
}): FakeInteraction {
  return {
    isChatInputCommand: () => opts.isChatInput ?? true,
    commandName: opts.commandName,
    user: { id: "user-123" },
    guildId: "guild-1",
    channelId: "chan-1",
    member: {
      roles: {
        cache: new Collection((opts.roleIds ?? []).map((id) => [id, { id }])),
      },
    },
    replied: false,
    deferred: false,
    reply: mock(() => Promise.resolve()),
    followUp: mock(() => Promise.resolve()),
  };
}

describe("interaction-create event handler", () => {
  test("ignores non-chat-input interactions", async () => {
    const commands = new Collection<string, Command>();
    const interaction = makeInteraction({ commandName: "x", isChatInput: false });
    await interactionCreate.execute(interaction as any, commands);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test("silently returns when command not registered", async () => {
    const commands = new Collection<string, Command>();
    const interaction = makeInteraction({ commandName: "unknown" });
    await interactionCreate.execute(interaction as any, commands);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test("denies permission when requiredRole is missing", async () => {
    const execute = mock(() => Promise.resolve());
    const commands = new Collection<string, Command>();
    commands.set("dev-only", {
      data: { name: "dev-only", toJSON: () => ({}) } as any,
      requiredRole: "dev",
      execute,
    });

    const interaction = makeInteraction({ commandName: "dev-only", roleIds: [] });
    await interactionCreate.execute(interaction as any, commands);

    expect(execute).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const replyArg = interaction.reply.mock.calls[0]![0];
    expect(replyArg.embeds?.[0]?.data?.description).toContain("don't have permission");
  });

  test("executes when requiredRole is satisfied", async () => {
    const execute = mock(() => Promise.resolve());
    const commands = new Collection<string, Command>();
    commands.set("dev-only", {
      data: { name: "dev-only", toJSON: () => ({}) } as any,
      requiredRole: "dev",
      execute,
    });

    const interaction = makeInteraction({ commandName: "dev-only", roleIds: [DEV_ROLE] });
    await interactionCreate.execute(interaction as any, commands);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test("sends error reply when execute throws and interaction was not replied", async () => {
    const execute = mock(() => Promise.reject(new Error("boom")));
    const commands = new Collection<string, Command>();
    commands.set("broken", {
      data: { name: "broken", toJSON: () => ({}) } as any,
      execute,
    });

    const interaction = makeInteraction({ commandName: "broken" });
    await interactionCreate.execute(interaction as any, commands);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const replyArg = interaction.reply.mock.calls[0]![0];
    expect(replyArg.embeds?.[0]?.data?.description).toContain("Something went wrong");
  });

  test("uses followUp when execute throws after defer", async () => {
    const execute = mock(() => Promise.reject(new Error("boom")));
    const commands = new Collection<string, Command>();
    commands.set("broken", {
      data: { name: "broken", toJSON: () => ({}) } as any,
      execute,
    });

    const interaction = makeInteraction({ commandName: "broken" });
    interaction.deferred = true;
    await interactionCreate.execute(interaction as any, commands);

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test("swallows error when the error reply itself fails (no unhandled rejection)", async () => {
    const execute = mock(() => Promise.reject(new Error("boom")));
    const commands = new Collection<string, Command>();
    commands.set("broken", {
      data: { name: "broken", toJSON: () => ({}) } as any,
      execute,
    });

    const interaction = makeInteraction({ commandName: "broken" });
    interaction.reply = mock(() => Promise.reject(new Error("reply-failed"))) as any;

    // Must NOT throw — previous implementation would bubble to unhandledRejection.
    await interactionCreate.execute(interaction as any, commands);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
