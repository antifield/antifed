import { describe, expect, test } from "bun:test";

type RawOpt = { name: string; required?: boolean; type?: number };

const { default: pageCommand } = await import("../../src/commands/utility/page");

describe("/page command", () => {
  test("has correct command metadata", () => {
    const json = pageCommand.data.toJSON();
    expect(json.name).toBe("page");
    expect(json.description).toContain("Better Stack");
  });

  test("requires reason option", () => {
    const json = pageCommand.data.toJSON();
    const opts = (json.options as RawOpt[] | undefined) ?? [];
    const required = opts.filter((o) => o.required);
    expect(required).toHaveLength(1);
    expect(required[0]?.name).toBe("reason");
  });

  test("has optional critical boolean", () => {
    const json = pageCommand.data.toJSON();
    const opts = (json.options as RawOpt[] | undefined) ?? [];
    const critical = opts.find((o) => o.name === "critical");
    expect(critical).toBeDefined();
    expect(critical?.required).toBeFalsy();
  });
});
