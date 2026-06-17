import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Collection } from "discord.js";
import { createTestDb } from "../helpers/db";

// In-memory libsql with the real schema, plus stubs for the env, mod-log, and
// logger so the handler runs against real SQL while we assert on side effects.
const testEnv = await createTestDb();
await mock.module("~/db", () => ({ db: testEnv.db }));

const honeypotEnv = {
  HONEYPOT_CHANNEL_ID: "honeypot-1",
  MODERATOR_ROLE_ID: "mod-role",
  BOT_DEVELOPER_ROLE_ID: "dev-role",
};
await mock.module("~/env", () => ({ env: honeypotEnv }));

const sendModLog = mock(async (_guild: unknown, _embed: unknown) => undefined);
await mock.module("~/lib/mod-log", () => ({ sendModLog }));

const logInfo = mock((_entry: unknown) => undefined);
const logWarn = mock((_entry: unknown) => undefined);
const logError = mock((_entry: unknown) => undefined);
await mock.module("~/lib/logger", () => ({
  log: { info: logInfo, warn: logWarn, error: logError },
}));

const { infractions } = await import("../../src/db/schema");
const { default: messageCreate } = await import("../../src/events/message-create");

afterAll(() => {
  mock.restore();
  testEnv.client.close();
});

type BanOptions = { reason?: string; deleteMessageSeconds?: number };

function makeMessage(
  opts: {
    authorId?: string;
    noUsername?: boolean;
    channelId?: string;
    inGuild?: boolean;
    system?: boolean;
    bot?: boolean;
    webhookId?: string | null;
    roleIds?: string[];
    banImpl?: (user: unknown, options?: BanOptions) => Promise<void>;
    sendImpl?: () => Promise<void>;
  } = {},
) {
  const author = {
    id: opts.authorId ?? "spammer-1",
    username: opts.noUsername ? undefined : "spammer",
    bot: opts.bot ?? false,
    displayAvatarURL: () => "https://example.com/a.png",
    send: mock(opts.sendImpl ?? (async () => undefined)),
  };

  const ban = mock(opts.banImpl ?? (async (_u: unknown, _o?: BanOptions) => undefined));

  const member = {
    roles: {
      cache: new Collection((opts.roleIds ?? []).map((id) => [id, { id }])),
    },
  };

  const message = {
    channelId: opts.channelId ?? "honeypot-1",
    webhookId: opts.webhookId ?? null,
    system: opts.system ?? false,
    inGuild: () => opts.inGuild ?? true,
    author,
    member,
    client: {
      user: {
        id: "bot-1",
        username: "antifed",
        displayAvatarURL: () => "https://example.com/bot.png",
      },
    },
    guild: { name: "Test Guild", members: { ban } },
  };

  return { message, author, ban };
}

beforeEach(async () => {
  await testEnv.client.batch(["DELETE FROM infractions", "DELETE FROM users"], "write");
  sendModLog.mockClear();
  logInfo.mockClear();
  logWarn.mockClear();
  logError.mockClear();
});

describe("honeypot auto-ban", () => {
  test("DMs before banning, purges 7 days, records the ban, and logs to mod-log", async () => {
    const order: string[] = [];
    let banOptions: BanOptions | undefined;
    const { message, ban, author } = makeMessage({
      sendImpl: async () => {
        order.push("dm");
      },
      banImpl: async (_u, o) => {
        order.push("ban");
        banOptions = o;
      },
    });

    await messageCreate.execute(message as any);

    expect(order).toEqual(["dm", "ban"]);
    expect(author.send).toHaveBeenCalledTimes(1);
    expect(ban).toHaveBeenCalledTimes(1);
    expect(banOptions?.deleteMessageSeconds).toBe(7 * 86400);
    expect(banOptions?.reason).toContain("spam bot");

    const rows = await testEnv.db.select().from(infractions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("ban");
    expect(rows[0]?.moderatorId).toBe("bot-1");

    expect(sendModLog).toHaveBeenCalledTimes(1);
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({ action: "honeypot-ban", status: "banned", dmStatus: "sent" }),
    );
  });

  test("ignores messages in other channels", async () => {
    const { message, ban } = makeMessage({ channelId: "general-1" });
    await messageCreate.execute(message as any);
    expect(ban).not.toHaveBeenCalled();
    expect(await testEnv.db.select().from(infractions).all()).toHaveLength(0);
  });

  test("ignores bots", async () => {
    const { message, ban } = makeMessage({ bot: true });
    await messageCreate.execute(message as any);
    expect(ban).not.toHaveBeenCalled();
  });

  test("ignores webhook messages", async () => {
    const { message, ban } = makeMessage({ webhookId: "wh-1" });
    await messageCreate.execute(message as any);
    expect(ban).not.toHaveBeenCalled();
  });

  test("ignores messages outside a guild", async () => {
    const { message, ban } = makeMessage({ inGuild: false });
    await messageCreate.execute(message as any);
    expect(ban).not.toHaveBeenCalled();
  });

  test("ignores system messages", async () => {
    const { message, ban } = makeMessage({ system: true });
    await messageCreate.execute(message as any);
    expect(ban).not.toHaveBeenCalled();
  });

  test("exempts staff who post in the channel", async () => {
    const { message, ban } = makeMessage({ roleIds: ["mod-role"] });
    await messageCreate.execute(message as any);
    expect(ban).not.toHaveBeenCalled();
    expect(await testEnv.db.select().from(infractions).all()).toHaveLength(0);
  });

  test("is a no-op when the honeypot channel is not configured", async () => {
    const previous = honeypotEnv.HONEYPOT_CHANNEL_ID;
    honeypotEnv.HONEYPOT_CHANNEL_ID = undefined as unknown as string;
    try {
      const { message, ban } = makeMessage();
      await messageCreate.execute(message as any);
      expect(ban).not.toHaveBeenCalled();
    } finally {
      honeypotEnv.HONEYPOT_CHANNEL_ID = previous;
    }
  });

  test("bans only once for a burst of messages from the same author", async () => {
    const first = makeMessage({ authorId: "burst-1" });
    const second = makeMessage({ authorId: "burst-1" });

    const p1 = messageCreate.execute(first.message as any);
    const p2 = messageCreate.execute(second.message as any);
    await Promise.all([p1, p2]);

    expect(first.ban).toHaveBeenCalledTimes(1);
    expect(second.ban).not.toHaveBeenCalled();
    expect(second.author.send).not.toHaveBeenCalled();
    expect(await testEnv.db.select().from(infractions).all()).toHaveLength(1);
  });

  test("still bans and records when the DM fails, noting it in the mod-log", async () => {
    const { message, ban } = makeMessage({
      sendImpl: async () => {
        throw new Error("Cannot send messages to this user");
      },
    });

    await messageCreate.execute(message as any);

    expect(ban).toHaveBeenCalledTimes(1);
    expect(await testEnv.db.select().from(infractions).all()).toHaveLength(1);
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "dm", status: "failed" }),
    );
    const embed = sendModLog.mock.calls[0]?.[1] as { data?: { description?: string } };
    expect(embed?.data?.description).toContain("Could not DM");
  });

  test("logs and skips the record when the ban itself fails", async () => {
    const { message, ban } = makeMessage({
      banImpl: async () => {
        throw new Error("Missing Permissions");
      },
    });

    await messageCreate.execute(message as any);

    expect(ban).toHaveBeenCalledTimes(1);
    expect(await testEnv.db.select().from(infractions).all()).toHaveLength(0);
    expect(sendModLog).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ action: "honeypot-ban", status: "ban_failed" }),
    );
  });

  test("keeps the ban when writing the audit record fails", async () => {
    // A user with no username fails the NOT NULL insert in ensureUser, exercising
    // the persist-failure branch after the ban has already gone through.
    const { message, ban } = makeMessage({ noUsername: true });

    await messageCreate.execute(message as any);

    expect(ban).toHaveBeenCalledTimes(1);
    expect(await testEnv.db.select().from(infractions).all()).toHaveLength(0);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ action: "infraction-insert", type: "ban" }),
    );
    expect(sendModLog).toHaveBeenCalledTimes(1);
    const embed = sendModLog.mock.calls[0]?.[1] as { data?: { description?: string } };
    expect(embed?.data?.description).toContain("audit record failed");
  });
});
