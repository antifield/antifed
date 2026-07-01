import { describe, expect, test } from "bun:test";
import { INFRACTIONS_PER_PAGE } from "../../src/lib/constants";
import { buildInfractionPages, buildNotePages } from "../../src/lib/record-pages";

const targetUser = {
  username: "bob",
  displayAvatarURL: () => "https://example.com/a.png",
} as any;

const CREATED_AT = "2024-01-01T00:00:00.000Z";
const CREATED_TS = Math.floor(new Date(CREATED_AT).getTime() / 1000);

function infractionRecord(id: number, over: Partial<{ type: string; active: boolean }> = {}) {
  return {
    id,
    type: over.type ?? "ban",
    reason: `reason ${id}`,
    moderatorId: "mod-1",
    active: over.active ?? true,
    createdAt: CREATED_AT,
  };
}

function noteRecord(id: number) {
  return { id, authorId: "author-1", content: `note ${id}`, createdAt: CREATED_AT };
}

describe("buildInfractionPages", () => {
  test("returns no pages for an empty record set", () => {
    expect(buildInfractionPages([], targetUser)).toEqual([]);
  });

  test("renders type, reason, mod, and active state on a single page", () => {
    const pages = buildInfractionPages([infractionRecord(1)], targetUser);
    expect(pages).toHaveLength(1);
    const desc = pages[0]!.data.description!;
    expect(desc).toContain("`#1` **BAN**");
    expect(desc).toContain(`<t:${CREATED_TS}:R>`);
    expect(desc).toContain("> reason 1");
    expect(desc).toContain("Mod: <@mod-1> | Active");
  });

  test("marks removed infractions as Removed", () => {
    const pages = buildInfractionPages([infractionRecord(1, { active: false })], targetUser);
    expect(pages[0]!.data.description).toContain("| Removed");
  });

  test("splits into multiple pages past INFRACTIONS_PER_PAGE", () => {
    const records = Array.from({ length: INFRACTIONS_PER_PAGE + 1 }, (_, i) =>
      infractionRecord(i + 1),
    );
    expect(buildInfractionPages(records, targetUser)).toHaveLength(2);
  });

  test("shows a total-count footer only when requested", () => {
    const records = [infractionRecord(1), infractionRecord(2)];
    expect(buildInfractionPages(records, targetUser)[0]!.data.footer?.text).toBeUndefined();
    expect(
      buildInfractionPages(records, targetUser, { showFooter: true })[0]!.data.footer?.text,
    ).toBe("2 infractions");
  });
});

describe("buildNotePages", () => {
  test("renders the note quote, author mention, and relative timestamp", () => {
    const pages = buildNotePages([noteRecord(1)], targetUser);
    expect(pages).toHaveLength(1);
    const desc = pages[0]!.data.description!;
    expect(desc).toContain("`#1`");
    expect(desc).toContain(`<t:${CREATED_TS}:R>`);
    expect(desc).toContain("by <@author-1>");
    expect(desc).toContain("> note 1");
  });

  test("splits and footers like infractions", () => {
    const records = Array.from({ length: INFRACTIONS_PER_PAGE + 1 }, (_, i) => noteRecord(i + 1));
    const pages = buildNotePages(records, targetUser, { showFooter: true });
    expect(pages).toHaveLength(2);
    expect(pages[0]!.data.footer?.text).toBe(`${INFRACTIONS_PER_PAGE + 1} notes`);
  });
});
