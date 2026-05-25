import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import { lastReplyDescription, type ReplyPayload } from "../helpers/mock-types";

const testEnv = await createTestDb();
await mock.module("~/db", () => ({ db: testEnv.db }));
await mock.module("~/lib/mod-log", () => ({ sendModLog: mock(async () => undefined) }));

const { infractions, users } = await import("../../src/db/schema");
const { default: modCommand } = await import("../../src/commands/moderation/mod");

afterAll(() => {
  testEnv.client.close();
});

function makeUser(overrides: Partial<{ id: string; username: string; dmOk: boolean }> = {}) {
  const id = overrides.id ?? "target-1";
  const username = overrides.username ?? "target";
  const dmOk = overrides.dmOk ?? true;
  return {
    id,
    username,
    displayAvatarURL: () => "https://example.com/t.png",
    send: mock(async () => {
      if (!dmOk) throw new Error("DMs closed");
    }),
  };
}

function makeGuildMember(id: string, rolePosition: number, ownerId = "owner-1") {
  return {
    id,
    user: {
      id,
      username: `u-${id}`,
      displayAvatarURL: () => "https://example.com/u.png",
    },
    roles: { highest: { position: rolePosition } },
    guild: { ownerId, members: { me: { id: "bot-1" } } },
    kick: mock(async () => undefined),
  };
}

function makeInteraction(opts: {
  sub: string;
  target: ReturnType<typeof makeUser>;
  reason?: string;
  silent?: boolean;
  deleteMessages?: number;
  moderatorId?: string;
  moderatorPosition?: number;
  targetInGuild?: boolean;
  targetRolePosition?: number;
  banImpl?: (user: { id: string }, options?: unknown) => Promise<void>;
  unbanImpl?: (id: string, reason?: string) => Promise<void>;
  kickImpl?: () => Promise<void>;
}) {
  const moderatorId = opts.moderatorId ?? "mod-1";
  const editReply = mock(async (_payload: ReplyPayload) => ({}));
  const targetMember = opts.targetInGuild
    ? makeGuildMember(opts.target.id, opts.targetRolePosition ?? 1)
    : null;
  if (targetMember && opts.kickImpl) targetMember.kick = mock(opts.kickImpl) as any;

  const fetchMember = mock(async (id: string) => {
    if (id === moderatorId) return makeGuildMember(moderatorId, opts.moderatorPosition ?? 10);
    if (id === opts.target.id) {
      if (!targetMember) throw new Error("Unknown Member");
      return targetMember;
    }
    return null;
  });

  return {
    targetMember,
    moderatorId,
    interaction: {
      options: {
        getSubcommand: () => opts.sub,
        getUser: (_n: string, _req?: boolean) => opts.target,
        getString: (name: string, _req?: boolean) =>
          name === "reason" ? (opts.reason ?? "no reason") : null,
        getInteger: (name: string, _req?: boolean) =>
          name === "delete_messages" ? (opts.deleteMessages ?? null) : null,
        getBoolean: (name: string, _req?: boolean) =>
          name === "silent" ? (opts.silent ?? false) : null,
      },
      user: {
        id: moderatorId,
        username: "mod",
        displayAvatarURL: () => "https://example.com/m.png",
      },
      guild: {
        id: "guild-1",
        name: "Test Guild",
        ownerId: "owner-1",
        members: {
          fetch: fetchMember,
          ban: opts.banImpl ?? mock(async () => undefined),
          unban: opts.unbanImpl ?? mock(async () => undefined),
          me: { id: "bot-1" },
        },
      },
      guildId: "guild-1",
      channelId: "chan-1",
      deferReply: mock(async () => undefined),
      editReply,
      reply: mock(async () => undefined),
      followUp: mock(async () => undefined),
      deferred: false,
      replied: false,
    },
  };
}

beforeEach(async () => {
  await testEnv.client.batch(["DELETE FROM infractions", "DELETE FROM users"], "write");
});

describe("/mod warn", () => {
  test("inserts an infraction row and DMs the user", async () => {
    const target = makeUser();
    const { interaction } = makeInteraction({ sub: "warn", target, reason: "be nice" });

    await modCommand.execute(interaction as any);

    expect(target.send).toHaveBeenCalledTimes(1);
    const rows = await testEnv.db.select().from(infractions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("warn");
    expect(rows[0]?.reason).toBe("be nice");
    expect(rows[0]?.active).toBe(true);
  });

  test("reports DM failure in reply text but still records the warn", async () => {
    const target = makeUser({ dmOk: false });
    const { interaction } = makeInteraction({ sub: "warn", target, reason: "r" });

    await modCommand.execute(interaction as any);

    const rows = await testEnv.db.select().from(infractions).all();
    expect(rows).toHaveLength(1);

    expect(lastReplyDescription(interaction.editReply)).toMatch(/Could not DM/);
  });
});

describe("/mod ban", () => {
  test("DMs before banning so the user still shares the guild", async () => {
    const target = makeUser({ id: "target-ban" });
    const callOrder: string[] = [];

    const banImpl = mock(async (_u: unknown) => {
      callOrder.push("ban");
    });
    target.send = mock(async () => {
      callOrder.push("dm");
    }) as any;

    const { interaction } = makeInteraction({
      sub: "ban",
      target,
      targetInGuild: true,
      targetRolePosition: 1,
      moderatorPosition: 10,
      banImpl,
    });

    await modCommand.execute(interaction as any);

    expect(callOrder).toEqual(["dm", "ban"]);
    const rows = await testEnv.db.select().from(infractions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("ban");
  });

  test("does not record when the ban call fails", async () => {
    const target = makeUser({ id: "target-ban-fail" });
    target.send = mock(async () => {}) as any;
    const banImpl = mock(async () => {
      throw new Error("Missing Permissions");
    });

    const { interaction } = makeInteraction({
      sub: "ban",
      target,
      targetInGuild: true,
      targetRolePosition: 1,
      moderatorPosition: 10,
      banImpl,
    });

    await modCommand.execute(interaction as any);

    expect(target.send).toHaveBeenCalledTimes(1);
    const rows = await testEnv.db.select().from(infractions).all();
    expect(rows).toHaveLength(0);

    expect(lastReplyDescription(interaction.editReply)).toMatch(/Failed to ban/i);
  });

  test("blocks banning the server owner when they've left the guild", async () => {
    const owner = makeUser({ id: "owner-1" });
    const banImpl = mock(async () => undefined);

    const { interaction } = makeInteraction({
      sub: "ban",
      target: owner,
      targetInGuild: false, // owner no longer in guild (still resolvable as user)
      banImpl,
    });

    await modCommand.execute(interaction as any);

    expect(banImpl).not.toHaveBeenCalled();
    expect(lastReplyDescription(interaction.editReply)).toMatch(/server owner/i);
  });

  test("blocks banning a member whose role is >= moderator's", async () => {
    const target = makeUser({ id: "target-high" });
    const banImpl = mock(async () => undefined);

    const { interaction } = makeInteraction({
      sub: "ban",
      target,
      targetInGuild: true,
      targetRolePosition: 10,
      moderatorPosition: 5,
      banImpl,
    });

    await modCommand.execute(interaction as any);

    expect(banImpl).not.toHaveBeenCalled();
    expect(lastReplyDescription(interaction.editReply)).toMatch(/Cannot moderate/i);
  });
});

describe("/mod kick", () => {
  test("errors when target is not in the server", async () => {
    const target = makeUser({ id: "target-gone" });
    const { interaction } = makeInteraction({
      sub: "kick",
      target,
      targetInGuild: false,
    });

    await modCommand.execute(interaction as any);

    expect(lastReplyDescription(interaction.editReply)).toMatch(/not in the server/i);
    const rows = await testEnv.db.select().from(infractions).all();
    expect(rows).toHaveLength(0);
  });

  test("DMs only after a successful kick", async () => {
    const target = makeUser({ id: "target-k" });
    const order: string[] = [];
    target.send = mock(async () => {
      order.push("dm");
    }) as any;

    const { interaction, targetMember } = makeInteraction({
      sub: "kick",
      target,
      targetInGuild: true,
      targetRolePosition: 1,
      moderatorPosition: 10,
      kickImpl: async () => {
        order.push("kick");
      },
    });
    expect(targetMember).not.toBeNull();

    await modCommand.execute(interaction as any);

    expect(order).toEqual(["kick", "dm"]);
    const rows = await testEnv.db.select().from(infractions).all();
    expect(rows[0]?.type).toBe("kick");
  });
});

describe("ensureUser integration", () => {
  test("warning the same user twice only creates one user row", async () => {
    const target = makeUser({ id: "target-dup" });
    const first = makeInteraction({ sub: "warn", target, reason: "first" });
    const second = makeInteraction({ sub: "warn", target, reason: "second" });

    await modCommand.execute(first.interaction as any);
    await modCommand.execute(second.interaction as any);

    const userRows = await testEnv.db
      .select()
      .from(users)
      .where(eq(users.discordId, target.id))
      .all();
    expect(userRows).toHaveLength(1);
    const infractionRows = await testEnv.db.select().from(infractions).all();
    expect(infractionRows).toHaveLength(2);
  });
});
