import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createTestDb } from "../helpers/db";

// In-memory libsql with the real schema, plus stubs for mod-log and the logger,
// so the handler runs real SQL while we assert on the mod-log side effect.
const testEnv = await createTestDb();
await mock.module("~/db", () => ({ db: testEnv.db }));

const sendModLog = mock(async (_guild: unknown, _embed: unknown) => undefined);
await mock.module("~/lib/mod-log", () => ({ sendModLog }));

const logInfo = mock((_entry: unknown) => undefined);
const logError = mock((_entry: unknown) => undefined);
await mock.module("~/lib/logger", () => ({
  log: { info: logInfo, warn: mock(() => undefined), error: logError },
}));

const { infractions, notes, users } = await import("../../src/db/schema");
const { default: guildMemberAdd } = await import("../../src/events/guild-member-add");

afterAll(() => {
  mock.restore();
  testEnv.client.close();
});

function makeMember(opts: { id?: string; bot?: boolean } = {}) {
  const id = opts.id ?? "user-1";
  return {
    id,
    user: {
      id,
      username: "returning",
      bot: opts.bot ?? false,
      displayAvatarURL: () => "https://example.com/a.png",
      createdAt: new Date("2020-01-01T00:00:00Z"),
    },
    guild: { name: "Test Guild" },
  };
}

async function seedUser(discordId: string): Promise<number> {
  const [row] = await testEnv.db
    .insert(users)
    .values({ discordId, username: "returning" })
    .returning();
  return row!.id;
}

beforeEach(async () => {
  await testEnv.client.batch(
    ["DELETE FROM infractions", "DELETE FROM notes", "DELETE FROM users"],
    "write",
  );
  sendModLog.mockClear();
  logInfo.mockClear();
  logError.mockClear();
});

describe("rejoin history alert", () => {
  test("alerts when a returning member has prior infractions", async () => {
    const userId = await seedUser("user-1");
    await testEnv.db.insert(infractions).values([
      { userId, moderatorId: "mod-1", type: "ban", reason: "raid spam" },
      { userId, moderatorId: "mod-1", type: "warn", reason: "rude" },
    ]);

    await guildMemberAdd.execute(makeMember({ id: "user-1" }) as any);

    expect(sendModLog).toHaveBeenCalledTimes(1);
    const embed = sendModLog.mock.calls[0]?.[1] as {
      data?: { author?: { name?: string }; description?: string };
    };
    expect(embed?.data?.author?.name).toBe("Flagged Member Rejoined");
    expect(embed?.data?.description).toContain("1 ban");
    expect(embed?.data?.description).toContain("1 warn");
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({ action: "rejoin-alert", status: "flagged" }),
    );
  });

  test("marks removed infractions distinctly", async () => {
    const userId = await seedUser("user-2");
    await testEnv.db
      .insert(infractions)
      .values({ userId, moderatorId: "mod-1", type: "ban", reason: "compromised", active: false });

    await guildMemberAdd.execute(makeMember({ id: "user-2" }) as any);

    expect(sendModLog).toHaveBeenCalledTimes(1);
    const embed = sendModLog.mock.calls[0]?.[1] as { data?: { description?: string } };
    expect(embed?.data?.description).toContain("removed");
  });

  test("does not alert a member with no record", async () => {
    await guildMemberAdd.execute(makeMember({ id: "stranger" }) as any);
    expect(sendModLog).not.toHaveBeenCalled();
  });

  test("does not alert when the user row exists but has no infractions", async () => {
    await seedUser("user-1");
    await guildMemberAdd.execute(makeMember({ id: "user-1" }) as any);
    expect(sendModLog).not.toHaveBeenCalled();
  });

  test("does not alert on a staff note alone (notes do not trigger)", async () => {
    const userId = await seedUser("user-1");
    await testEnv.db.insert(notes).values({ userId, authorId: "mod-1", content: "watch them" });

    await guildMemberAdd.execute(makeMember({ id: "user-1" }) as any);
    expect(sendModLog).not.toHaveBeenCalled();
  });

  test("ignores bots before touching the database", async () => {
    const userId = await seedUser("bot-x");
    await testEnv.db
      .insert(infractions)
      .values({ userId, moderatorId: "mod-1", type: "ban", reason: "x" });

    await guildMemberAdd.execute(makeMember({ id: "bot-x", bot: true }) as any);
    expect(sendModLog).not.toHaveBeenCalled();
  });

  test("suppresses a repeat alert within the cooldown window", async () => {
    const userId = await seedUser("flood-1");
    await testEnv.db
      .insert(infractions)
      .values({ userId, moderatorId: "mod-1", type: "warn", reason: "noise" });
    const member = makeMember({ id: "flood-1" });

    await guildMemberAdd.execute(member as any);
    await guildMemberAdd.execute(member as any);

    expect(sendModLog).toHaveBeenCalledTimes(1);
  });

  test("includes the note count in the alert when the member has notes", async () => {
    const userId = await seedUser("noted-1");
    await testEnv.db
      .insert(infractions)
      .values({ userId, moderatorId: "mod-1", type: "warn", reason: "x" });
    await testEnv.db
      .insert(notes)
      .values({ userId, authorId: "mod-1", content: "keep an eye out" });

    await guildMemberAdd.execute(makeMember({ id: "noted-1" }) as any);

    const embed = sendModLog.mock.calls[0]?.[1] as { data?: { description?: string } };
    expect(embed?.data?.description).toContain("1 note");
  });
});
