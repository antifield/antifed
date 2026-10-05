import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  ApplicationCommandOptionType,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
} from "discord.js";
import { createTestDb } from "../helpers/db";
import { lastReplyDescription, type ReplyPayload } from "../helpers/mock-types";

const testEnv = await createTestDb();
await mock.module("~/db", () => ({ db: testEnv.db }));
const sendModLog = mock(async (_guild: unknown, _embed: EmbedBuilder) => undefined);
await mock.module("~/lib/mod-log", () => ({ sendModLog }));
await mock.module("~/lib/logger", () => ({
  log: { info: mock(() => undefined), warn: mock(() => undefined), error: mock(() => undefined) },
}));

const { infractions } = await import("../../src/db/schema");
const { default: modCommand } = await import("../../src/commands/moderation/mod");

afterAll(() => {
  mock.restore();
  testEnv.client.close();
});

beforeEach(async () => {
  await testEnv.client.batch(["DELETE FROM infractions", "DELETE FROM users"], "write");
  sendModLog.mockClear();
});

function makeBan(opts: { canAppeal?: boolean; noDm?: boolean; dmFails?: boolean } = {}) {
  const order: string[] = [];
  const target = {
    id: "target-1",
    username: "target",
    displayAvatarURL: () => "https://example.com/target.png",
    send: mock(async (_payload: { embeds: EmbedBuilder[] }) => {
      order.push("dm");
      if (opts.dmFails) throw new Error("DMs closed");
    }),
  };
  const interaction = {
    options: {
      getSubcommand: () => "ban",
      getUser: () => target,
      getString: () => "Rule violation",
      getInteger: () => null,
      getBoolean: (name: string) => {
        if (name === "can_appeal") return opts.canAppeal ?? null;
        if (name === "no_dm") return opts.noDm ?? null;
        return null;
      },
    },
    user: {
      id: "mod-1",
      username: "moderator",
      displayAvatarURL: () => "https://example.com/moderator.png",
    },
    guild: {
      name: "Test Guild",
      ownerId: "owner-1",
      members: {
        fetch: mock(async (id: string) => ({
          id,
          roles: { highest: { position: id === "mod-1" ? 10 : 1 } },
          guild: { ownerId: "owner-1", members: { me: { id: "bot-1" } } },
        })),
        ban: mock(async () => {
          order.push("ban");
        }),
      },
    },
    deferReply: mock(async () => undefined),
    editReply: mock(async (_payload: ReplyPayload) => undefined),
  };

  return { target, interaction, order };
}

describe("/mod ban appeals", () => {
  test("exposes can_appeal as an optional boolean only on ban", () => {
    const options = modCommand.data.toJSON().options;
    for (const sub of options ?? []) {
      if (!("options" in sub)) throw new Error("Expected a subcommand");
      const appeal = sub.options?.find((option) => option.name === "can_appeal");
      if (sub.name === "ban") {
        expect(appeal?.type).toBe(ApplicationCommandOptionType.Boolean);
        expect(appeal && "required" in appeal ? appeal.required : undefined).toBeFalsy();
      } else {
        expect(appeal).toBeUndefined();
      }
    }
  });

  test.each([undefined, false])("is not appealable with can_appeal=%s", async (canAppeal) => {
    const { target, interaction, order } = makeBan({ canAppeal });

    await modCommand.execute(interaction as unknown as ChatInputCommandInteraction);

    const dm = target.send.mock.calls[0]?.[0].embeds[0]?.toJSON();
    expect(dm?.footer?.text).toBe("Test Guild • This ban is not appealable.");
    expect(dm?.description).toBe("Rule violation");
    expect(order).toEqual(["dm", "ban"]);
    const rows = await testEnv.db.select().from(infractions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("ban");
  });

  test.each([undefined, false])(
    "DMs appeal instructions before banning with no_dm=%s",
    async (noDm) => {
      const { target, interaction, order } = makeBan({ canAppeal: true, noDm });

      await modCommand.execute(interaction as unknown as ChatInputCommandInteraction);

      expect(target.send.mock.calls[0]?.[0].embeds[0]?.toJSON().footer?.text).toBe(
        "Test Guild • You can appeal this ban by emailing marcel@antifield.com.",
      );
      expect(order).toEqual(["dm", "ban"]);
      expect(lastReplyDescription(interaction.editReply)).not.toContain("DM skipped");
      const rows = await testEnv.db.select().from(infractions).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.reason).toBe("Rule violation");
    },
  );

  test("rejects can_appeal with no_dm before any moderation side effects", async () => {
    const { target, interaction } = makeBan({ canAppeal: true, noDm: true });

    await modCommand.execute(interaction as unknown as ChatInputCommandInteraction);

    expect(lastReplyDescription(interaction.editReply)).toContain("Set no_dm to false or omit it");
    expect(target.send).not.toHaveBeenCalled();
    expect(interaction.guild.members.fetch).not.toHaveBeenCalled();
    expect(interaction.guild.members.ban).not.toHaveBeenCalled();
    expect(sendModLog).not.toHaveBeenCalled();
    expect(await testEnv.db.select().from(infractions).all()).toHaveLength(0);
  });

  test.each([undefined, false])(
    "allows no_dm for a non-appealable ban with can_appeal=%s",
    async (canAppeal) => {
      const { target, interaction, order } = makeBan({ canAppeal, noDm: true });

      await modCommand.execute(interaction as unknown as ChatInputCommandInteraction);

      expect(target.send).not.toHaveBeenCalled();
      expect(order).toEqual(["ban"]);
      expect(lastReplyDescription(interaction.editReply)).toContain("DM skipped");
      expect(await testEnv.db.select().from(infractions).all()).toHaveLength(1);
    },
  );

  test("still bans when an appeal DM fails and reports the failure to staff", async () => {
    const { interaction, order } = makeBan({ canAppeal: true, dmFails: true });

    await modCommand.execute(interaction as unknown as ChatInputCommandInteraction);

    expect(order).toEqual(["dm", "ban"]);
    expect(lastReplyDescription(interaction.editReply)).toContain("Could not DM");
    expect(sendModLog.mock.calls[0]?.[1].toJSON().description).toContain("Could not DM");
    expect(await testEnv.db.select().from(infractions).all()).toHaveLength(1);
  });
});
