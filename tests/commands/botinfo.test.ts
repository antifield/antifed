import { describe, expect, test } from "bun:test";

type RawOpt = { name: string; required?: boolean };

const { default: botinfoCommand, formatUptime } = await import("../../src/commands/dev/botinfo");

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

describe("formatUptime", () => {
  // Zero middle units are omitted, but seconds are always shown.
  test.each([
    [0, "0s"],
    [5_000, "5s"],
    [59_000, "59s"],
    [65_000, "1m 5s"],
    [3_600_000, "1h 0s"],
    [90_000_000, "1d 1h 0s"],
    [93_784_000, "1d 2h 3m 4s"],
  ])("formats %ims as %s", (ms, expected) => {
    expect(formatUptime(ms)).toBe(expected);
  });
});
