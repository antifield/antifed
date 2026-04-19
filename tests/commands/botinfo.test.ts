import { describe, expect, test } from "bun:test";

type RawOpt = { name: string; required?: boolean };

const { default: botinfoCommand } = await import("../../src/commands/dev/botinfo");

describe("/botinfo command", () => {
  test("has correct command metadata", () => {
    const json = botinfoCommand.data.toJSON();
    expect(json.name).toBe("botinfo");
    expect(json.description).toContain("Dev");
  });

  test("has no required options", () => {
    const json = botinfoCommand.data.toJSON();
    const required = (json.options as RawOpt[] | undefined)?.filter((o) => o.required) ?? [];
    expect(required).toHaveLength(0);
  });
});
