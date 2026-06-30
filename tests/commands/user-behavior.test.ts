import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";

const testEnv = await createTestDb();
await mock.module("~/db", () => ({ db: testEnv.db }));
// Do not mock ~/lib/pagination here: Bun module mocks are process-global, and
// replacing it in this file leaks into tests/lib/pagination.test.ts during the
// full suite. These tests only inspect the initial /user info reply.

const { infractions, notes, users } = await import("../../src/db/schema");
const { default: userCommand } = await import("../../src/commands/moderation/user");

afterAll(() => {
  testEnv.client.close();
});

async function seedUser(discordId: string) {
  await testEnv.db.insert(users).values({ discordId, username: "t" });
}

async function userByDiscordId(discordId: string) {
  const [u] = await testEnv.db.select().from(users).where(eq(users.discordId, discordId)).all();
  return u!;
}

async function seedInfraction(opts: {
  discordId: string;
  type: "ban" | "warn" | "kick" | "softban";
  active: boolean;
  moderatorId?: string;
}) {
  const u = await userByDiscordId(opts.discordId);
  await testEnv.db.insert(infractions).values({
    userId: u.id,
    moderatorId: opts.moderatorId ?? "mod-1",
    type: opts.type,
    reason: "x",
    active: opts.active,
  });
}

async function seedNote(opts: { discordId: string; content: string; authorId?: string }) {
  const u = await userByDiscordId(opts.discordId);
  await testEnv.db.insert(notes).values({
    userId: u.id,
    authorId: opts.authorId ?? "mod-1",
    content: opts.content,
  });
}

function makeInfoInteraction(targetId: string, targetUsername = "target") {
  const editReply = mock(async (_arg?: unknown) => ({
    createMessageComponentCollector: () => ({
      on: mock(() => undefined),
    }),
  }));
  return {
    id: "int-1",
    options: {
      getSubcommand: () => "info",
      getUser: (_n: string, _req?: boolean) => ({
        id: targetId,
        username: targetUsername,
        displayAvatarURL: () => "https://example.com/a.png",
        createdAt: new Date("2024-01-01T00:00:00Z"),
      }),
    },
    user: {
      id: "mod-1",
      username: "mod",
      displayAvatarURL: () => "https://example.com/m.png",
    },
    guild: {
      members: {
        fetch: mock(async () => null),
      },
    },
    guildId: "guild-1",
    channelId: "chan-1",
    deferReply: mock(async () => undefined),
    editReply,
    reply: mock(async () => undefined),
  } as any;
}

function extractDescription(interaction: any): string {
  const call = interaction.editReply.mock.calls.at(-1);
  return call?.[0]?.embeds?.[0]?.data?.description ?? "";
}

describe("/user info — counts reflect active infractions only", () => {
  beforeEach(async () => {
    await testEnv.client.batch(
      ["DELETE FROM notes", "DELETE FROM infractions", "DELETE FROM users"],
      "write",
    );
  });

  test("unknown user shows zeros", async () => {
    const interaction = makeInfoInteraction("target-x");
    await userCommand.execute(interaction);
    const desc = extractDescription(interaction);
    expect(desc).toMatch(/\*\*0\*\* bans/);
    expect(desc).toMatch(/\*\*0\*\* warnings/);
    expect(desc).toMatch(/\*\*0\*\* notes/);
  });

  test("inactive (removed) ban does NOT count toward ban total", async () => {
    await seedUser("target-1");
    await seedInfraction({ discordId: "target-1", type: "ban", active: false });
    await seedInfraction({ discordId: "target-1", type: "warn", active: false });

    const interaction = makeInfoInteraction("target-1");
    await userCommand.execute(interaction);

    const desc = extractDescription(interaction);
    expect(desc).toMatch(/\*\*0\*\* bans/);
    expect(desc).toMatch(/\*\*0\*\* warnings/);
  });

  test("mixed active/inactive: only active are counted", async () => {
    await seedUser("target-2");
    await seedInfraction({ discordId: "target-2", type: "ban", active: true });
    await seedInfraction({ discordId: "target-2", type: "ban", active: false });
    await seedInfraction({ discordId: "target-2", type: "warn", active: true });
    await seedInfraction({ discordId: "target-2", type: "warn", active: true });
    await seedInfraction({ discordId: "target-2", type: "warn", active: false });

    const interaction = makeInfoInteraction("target-2");
    await userCommand.execute(interaction);

    const desc = extractDescription(interaction);
    expect(desc).toMatch(/\*\*1\*\* bans/);
    expect(desc).toMatch(/\*\*2\*\* warnings/);
  });

  test("notes are counted as-is (no active column)", async () => {
    await seedUser("target-3");
    await seedNote({ discordId: "target-3", content: "n1" });
    await seedNote({ discordId: "target-3", content: "n2" });

    const interaction = makeInfoInteraction("target-3");
    await userCommand.execute(interaction);
    const desc = extractDescription(interaction);
    expect(desc).toMatch(/\*\*2\*\* notes/);
  });
});

function extractInfractionButton(interaction: any): { label?: string; disabled?: boolean } {
  const call = interaction.editReply.mock.calls.at(-1);
  return call?.[0]?.components?.[0]?.components?.[0]?.data ?? {};
}

describe("/user info — infraction button reflects the full record", () => {
  beforeEach(async () => {
    await testEnv.client.batch(
      ["DELETE FROM notes", "DELETE FROM infractions", "DELETE FROM users"],
      "write",
    );
  });

  test("kicks and softbans appear in the summary", async () => {
    await seedUser("k-1");
    await seedInfraction({ discordId: "k-1", type: "kick", active: true });
    await seedInfraction({ discordId: "k-1", type: "softban", active: true });

    const interaction = makeInfoInteraction("k-1");
    await userCommand.execute(interaction);

    const desc = extractDescription(interaction);
    expect(desc).toMatch(/\*\*1\*\* kicks/);
    expect(desc).toMatch(/\*\*1\*\* softbans/);
  });

  test("button is enabled for a kick-only user (drill-down would show it)", async () => {
    await seedUser("k-2");
    await seedInfraction({ discordId: "k-2", type: "kick", active: true });

    const interaction = makeInfoInteraction("k-2");
    await userCommand.execute(interaction);

    const button = extractInfractionButton(interaction);
    expect(button.label).toBe("Infractions (1)");
    expect(button.disabled).toBe(false);
  });

  test("button counts the whole record, including removed infractions", async () => {
    await seedUser("k-3");
    await seedInfraction({ discordId: "k-3", type: "ban", active: true });
    await seedInfraction({ discordId: "k-3", type: "warn", active: false }); // removed
    await seedInfraction({ discordId: "k-3", type: "softban", active: true });

    const interaction = makeInfoInteraction("k-3");
    await userCommand.execute(interaction);

    const desc = extractDescription(interaction);
    expect(desc).toMatch(/\*\*1\*\* bans/);
    expect(desc).toMatch(/\*\*0\*\* warnings/); // removed warn excluded from the active summary
    expect(extractInfractionButton(interaction).label).toBe("Infractions (3)");
  });

  test("button is disabled when there are no infractions", async () => {
    await seedUser("k-4");
    await seedNote({ discordId: "k-4", content: "just a note" });

    const interaction = makeInfoInteraction("k-4");
    await userCommand.execute(interaction);

    const button = extractInfractionButton(interaction);
    expect(button.label).toBe("Infractions (0)");
    expect(button.disabled).toBe(true);
  });
});
