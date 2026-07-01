import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createTestDb } from "../helpers/db";

const testEnv = await createTestDb();
await mock.module("~/db", () => ({ db: testEnv.db }));
await mock.module("~/lib/mod-log", () => ({ sendModLog: mock(async () => undefined) }));

const { notes, users } = await import("../../src/db/schema");
const { default: noteCommand } = await import("../../src/commands/moderation/note");

afterAll(() => {
  testEnv.client.close();
});

beforeEach(async () => {
  await testEnv.client.batch(["DELETE FROM notes", "DELETE FROM users"], "write");
});

async function seedUser(discordId: string) {
  const [user] = await testEnv.db
    .insert(users)
    .values({ discordId, username: "target" })
    .returning();
  return user!;
}

function makeInteraction(opts: {
  sub: string;
  target?: { id: string; username?: string };
  content?: string;
  noteId?: number;
  isDev?: boolean;
}) {
  const editReply = mock(async () => ({}));
  return {
    // Drives the real hasDevRole gate on `clear` without a role-gates mock.
    member: { roles: { cache: { has: () => opts.isDev === true } } },
    options: {
      getSubcommand: () => opts.sub,
      getUser: (_n: string, _req?: boolean) =>
        opts.target
          ? {
              id: opts.target.id,
              // Honor an explicit `username: undefined` (used to force the
              // ensureUser NOT NULL failure) instead of defaulting it away.
              username: "username" in opts.target ? opts.target.username : "target",
              displayAvatarURL: () => "https://example.com/a.png",
            }
          : null,
      getString: (_n: string, _req?: boolean) => opts.content ?? null,
      getInteger: (_n: string, _req?: boolean) => opts.noteId ?? null,
    },
    user: { id: "mod-1", username: "mod", displayAvatarURL: () => "https://example.com/m.png" },
    guild: { id: "guild-1" },
    deferReply: mock(async () => undefined),
    editReply,
  } as any;
}

function lastReplyDescription(interaction: ReturnType<typeof makeInteraction>) {
  return interaction.editReply.mock.calls.at(-1)![0].embeds[0].data.description;
}

describe("/note add", () => {
  test("inserts a note and confirms with the content", async () => {
    await seedUser("u-1");
    const interaction = makeInteraction({
      sub: "add",
      target: { id: "u-1" },
      content: "watch this user",
    });

    await noteCommand.execute(interaction);

    const rows = await testEnv.db.select().from(notes).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ authorId: "mod-1", content: "watch this user" });
    expect(lastReplyDescription(interaction)).toContain("watch this user");
  });

  test("reports a failure and writes no row when the insert throws", async () => {
    // A missing username violates users.username NOT NULL inside ensureUser.
    const interaction = makeInteraction({
      sub: "add",
      target: { id: "u-2", username: undefined },
      content: "x",
    });

    await noteCommand.execute(interaction);

    expect(lastReplyDescription(interaction)).toMatch(/Failed to save the note/i);
    expect(await testEnv.db.select().from(notes).all()).toHaveLength(0);
  });
});

describe("/note remove", () => {
  test("rejects an unknown note id", async () => {
    const interaction = makeInteraction({ sub: "remove", noteId: 999 });
    await noteCommand.execute(interaction);
    expect(lastReplyDescription(interaction)).toMatch(/not found/i);
  });

  test("deletes an existing note and echoes its content", async () => {
    const user = await seedUser("u-3");
    const [note] = await testEnv.db
      .insert(notes)
      .values({ userId: user.id, authorId: "mod-1", content: "old note" })
      .returning();

    const interaction = makeInteraction({ sub: "remove", noteId: note!.id });
    await noteCommand.execute(interaction);

    expect(lastReplyDescription(interaction)).toContain("old note");
    expect(await testEnv.db.select().from(notes).all()).toHaveLength(0);
  });
});

describe("/note check", () => {
  test("reports no notes for an unknown user", async () => {
    const interaction = makeInteraction({ sub: "check", target: { id: "ghost" } });
    await noteCommand.execute(interaction);
    expect(lastReplyDescription(interaction)).toMatch(/No notes found/i);
  });

  test("lists notes on a single page", async () => {
    const user = await seedUser("u-4");
    await testEnv.db
      .insert(notes)
      .values({ userId: user.id, authorId: "mod-1", content: "a staff note" });

    const interaction = makeInteraction({ sub: "check", target: { id: "u-4" } });
    await noteCommand.execute(interaction);

    expect(lastReplyDescription(interaction)).toContain("a staff note");
  });
});

describe("/note clear", () => {
  test("is restricted to devs and leaves notes intact", async () => {
    const user = await seedUser("u-5");
    await testEnv.db
      .insert(notes)
      .values({ userId: user.id, authorId: "mod-1", content: "keep me" });

    const interaction = makeInteraction({ sub: "clear", target: { id: "u-5" }, isDev: false });
    await noteCommand.execute(interaction);

    expect(lastReplyDescription(interaction)).toMatch(/restricted to bot developers/i);
    expect(await testEnv.db.select().from(notes).all()).toHaveLength(1);
  });

  test("deletes all notes for a dev and reports the count", async () => {
    const user = await seedUser("u-6");
    await testEnv.db.insert(notes).values([
      { userId: user.id, authorId: "mod-1", content: "n1" },
      { userId: user.id, authorId: "mod-1", content: "n2" },
    ]);

    const interaction = makeInteraction({ sub: "clear", target: { id: "u-6" }, isDev: true });
    await noteCommand.execute(interaction);

    expect(lastReplyDescription(interaction)).toMatch(/Deleted \*\*2\*\* notes/);
    expect(await testEnv.db.select().from(notes).all()).toHaveLength(0);
  });
});
