import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";

// Spin up an in-memory libsql with the current schema and patch `~/db` before
// the command module evaluates. Using a real DB instead of mocking drizzle
// avoids the "mock lies, prod breaks" category of bug.
const testEnv = await createTestDb();
await mock.module("~/db", () => ({ db: testEnv.db }));
// mod-log is a no-op in tests (no TextChannel to send to).
await mock.module("~/lib/mod-log", () => ({ sendModLog: mock(async () => undefined) }));

const { infractions, users } = await import("../../src/db/schema");
const { default: infractionCommand } = await import("../../src/commands/moderation/infraction");

afterAll(() => {
  testEnv.client.close();
});

async function seed(opts: {
  discordId: string;
  infraction: { type: "ban" | "warn" | "kick" | "softban"; active?: boolean; moderatorId?: string };
}) {
  await testEnv.db.insert(users).values({ discordId: opts.discordId, username: "target" });
  const [user] = await testEnv.db
    .select()
    .from(users)
    .where(eq(users.discordId, opts.discordId))
    .all();
  const [row] = await testEnv.db
    .insert(infractions)
    .values({
      userId: user!.id,
      moderatorId: opts.infraction.moderatorId ?? "mod-1",
      type: opts.infraction.type,
      reason: "test",
      active: opts.infraction.active ?? true,
    })
    .returning();
  return { userRow: user!, infractionRow: row! };
}

function makeInteraction(opts: {
  sub: string;
  userId?: string;
  target?: { id: string; username?: string };
  infractionId?: number;
  unbanImpl?: (id: string, reason: string) => Promise<void>;
  isDev?: boolean;
  type?: string;
}) {
  const editReply = mock(async () => ({}));
  return {
    // `member.roles.cache.has` drives the real hasDevRole gate on `clear`; `has`
    // returns true for any role id when isDev, matching whatever role id env holds.
    member: { roles: { cache: { has: () => opts.isDev === true } } },
    options: {
      getSubcommand: () => opts.sub,
      getUser: (_n: string, _req?: boolean) =>
        opts.target
          ? {
              id: opts.target.id,
              username: opts.target.username ?? "target",
              displayAvatarURL: () => "https://example.com/a.png",
            }
          : null,
      getString: (name: string, _req?: boolean) => (name === "type" ? (opts.type ?? null) : null),
      getInteger: (_n: string, _req?: boolean) => opts.infractionId ?? null,
    },
    user: {
      id: opts.userId ?? "mod-1",
      username: "mod",
      displayAvatarURL: () => "https://example.com/m.png",
    },
    guild: {
      id: "guild-1",
      members: {
        unban: opts.unbanImpl ?? mock(async () => undefined),
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
  } as any;
}

describe("/infraction remove", () => {
  beforeEach(async () => {
    await testEnv.client.batch(["DELETE FROM infractions", "DELETE FROM users"], "write");
  });

  test("rejects unknown infraction id", async () => {
    const interaction = makeInteraction({ sub: "remove", infractionId: 999 });
    await infractionCommand.execute(interaction);

    const replyArg = interaction.editReply.mock.calls.at(-1)![0];
    expect(replyArg.embeds?.[0]?.data?.description).toMatch(/not found/i);
  });

  test("rejects already-inactive infraction", async () => {
    const { infractionRow } = await seed({
      discordId: "target-1",
      infraction: { type: "warn", active: false },
    });

    const interaction = makeInteraction({ sub: "remove", infractionId: infractionRow.id });
    await infractionCommand.execute(interaction);

    const replyArg = interaction.editReply.mock.calls.at(-1)![0];
    expect(replyArg.embeds?.[0]?.data?.description).toMatch(/already inactive/i);

    // Row should still be inactive (we didn't try to flip it back).
    const [row] = await testEnv.db
      .select()
      .from(infractions)
      .where(eq(infractions.id, infractionRow.id))
      .all();
    expect(row?.active).toBe(false);
  });

  test("non-ban: deactivates without calling unban", async () => {
    const { infractionRow } = await seed({ discordId: "target-2", infraction: { type: "warn" } });
    const unban = mock(async () => undefined);
    const interaction = makeInteraction({
      sub: "remove",
      infractionId: infractionRow.id,
      unbanImpl: unban,
    });

    await infractionCommand.execute(interaction);

    expect(unban).not.toHaveBeenCalled();
    const [row] = await testEnv.db
      .select()
      .from(infractions)
      .where(eq(infractions.id, infractionRow.id))
      .all();
    expect(row?.active).toBe(false);
  });

  test("ban: does NOT mark inactive if unban throws a real Discord error", async () => {
    const { infractionRow } = await seed({ discordId: "target-3", infraction: { type: "ban" } });
    const unban = mock(async () => {
      throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
    });
    const interaction = makeInteraction({
      sub: "remove",
      infractionId: infractionRow.id,
      unbanImpl: unban,
    });

    await infractionCommand.execute(interaction);

    expect(unban).toHaveBeenCalledTimes(1);
    const [row] = await testEnv.db
      .select()
      .from(infractions)
      .where(eq(infractions.id, infractionRow.id))
      .all();
    expect(row?.active).toBe(true);

    const replyArg = interaction.editReply.mock.calls.at(-1)![0];
    expect(replyArg.embeds?.[0]?.data?.description).toMatch(/not.*removed|Resolve the Discord/i);
  });

  test("ban: marks inactive when Discord reports Unknown Ban (10026)", async () => {
    const { infractionRow } = await seed({ discordId: "target-4", infraction: { type: "ban" } });
    const unban = mock(async () => {
      throw Object.assign(new Error("Unknown Ban"), { code: 10026 });
    });
    const interaction = makeInteraction({
      sub: "remove",
      infractionId: infractionRow.id,
      unbanImpl: unban,
    });

    await infractionCommand.execute(interaction);

    expect(unban).toHaveBeenCalledTimes(1);
    const [row] = await testEnv.db
      .select()
      .from(infractions)
      .where(eq(infractions.id, infractionRow.id))
      .all();
    expect(row?.active).toBe(false);
  });

  test("ban: marks inactive on successful unban", async () => {
    const { infractionRow } = await seed({ discordId: "target-5", infraction: { type: "ban" } });
    const unban = mock(async () => undefined);
    const interaction = makeInteraction({
      sub: "remove",
      infractionId: infractionRow.id,
      unbanImpl: unban,
    });

    await infractionCommand.execute(interaction);

    expect(unban).toHaveBeenCalledTimes(1);
    const [row] = await testEnv.db
      .select()
      .from(infractions)
      .where(eq(infractions.id, infractionRow.id))
      .all();
    expect(row?.active).toBe(false);
  });
});

describe("/infraction clear", () => {
  beforeEach(async () => {
    await testEnv.client.batch(["DELETE FROM infractions", "DELETE FROM users"], "write");
  });

  test("counts only the rows it actually deactivated, not already-inactive ones", async () => {
    // One user with 3 infractions: 2 active, 1 already inactive.
    const { userRow } = await seed({ discordId: "clear-1", infraction: { type: "warn" } });
    await testEnv.db.insert(infractions).values([
      { userId: userRow.id, moderatorId: "mod-1", type: "warn", reason: "test", active: true },
      { userId: userRow.id, moderatorId: "mod-1", type: "kick", reason: "test", active: false },
    ]);

    const interaction = makeInteraction({ sub: "clear", target: { id: "clear-1" }, isDev: true });
    await infractionCommand.execute(interaction);

    // Reports 2 (the active rows), not 3.
    const replyArg = interaction.editReply.mock.calls.at(-1)![0];
    expect(replyArg.embeds?.[0]?.data?.description).toMatch(/Deactivated \*\*2\*\*/);

    // But every row ends up inactive.
    const rows = await testEnv.db
      .select()
      .from(infractions)
      .where(eq(infractions.userId, userRow.id))
      .all();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.active === false)).toBe(true);
  });
});

describe("/infraction check", () => {
  beforeEach(async () => {
    await testEnv.client.batch(["DELETE FROM infractions", "DELETE FROM users"], "write");
  });

  function lastEmbedDescription(interaction: ReturnType<typeof makeInteraction>) {
    return interaction.editReply.mock.calls.at(-1)![0].embeds[0].data.description;
  }

  test("reports no infractions for an unknown user", async () => {
    const interaction = makeInteraction({ sub: "check", target: { id: "ghost" } });
    await infractionCommand.execute(interaction);
    expect(lastEmbedDescription(interaction)).toMatch(/No infractions found/i);
  });

  test("lists a user's infractions on a single page", async () => {
    await seed({ discordId: "chk-1", infraction: { type: "warn" } });
    const interaction = makeInteraction({ sub: "check", target: { id: "chk-1" } });
    await infractionCommand.execute(interaction);
    expect(lastEmbedDescription(interaction)).toContain("**WARN**");
  });

  test("filters by infraction type", async () => {
    const { userRow } = await seed({ discordId: "chk-2", infraction: { type: "warn" } });
    await testEnv.db.insert(infractions).values({
      userId: userRow.id,
      moderatorId: "mod-1",
      type: "ban",
      reason: "test",
      active: true,
    });

    const interaction = makeInteraction({ sub: "check", target: { id: "chk-2" }, type: "warn" });
    await infractionCommand.execute(interaction);

    const desc = lastEmbedDescription(interaction);
    expect(desc).toContain("**WARN**");
    expect(desc).not.toContain("**BAN**");
  });

  test("reports no matching infractions when the type filter excludes all", async () => {
    await seed({ discordId: "chk-3", infraction: { type: "ban" } });
    const interaction = makeInteraction({ sub: "check", target: { id: "chk-3" }, type: "warn" });
    await infractionCommand.execute(interaction);
    expect(lastEmbedDescription(interaction)).toMatch(/No warn infractions found/i);
  });
});
