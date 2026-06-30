import { describe, expect, test } from "bun:test";
import { formatError } from "../../src/lib/errors";

describe("formatError", () => {
  test("returns the stack trace for an Error that has one", () => {
    const err = new Error("boom");
    expect(formatError(err)).toBe(err.stack as string);
    expect(formatError(err)).toContain("boom");
  });

  test("falls back to the message when the Error has no stack", () => {
    const err = new Error("no stack here");
    err.stack = undefined;
    expect(formatError(err)).toBe("no stack here");
  });

  test("coerces a non-Error string via String()", () => {
    expect(formatError("plain string")).toBe("plain string");
  });

  test("coerces a non-Error object via String()", () => {
    expect(formatError({ code: 500 })).toBe("[object Object]");
  });

  test("coerces null and undefined via String()", () => {
    expect(formatError(null)).toBe("null");
    expect(formatError(undefined)).toBe("undefined");
  });
});
