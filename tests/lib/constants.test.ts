import { describe, expect, test } from "bun:test";
import { Colors, INFRACTIONS_PER_PAGE } from "../../src/lib/constants";

describe("Colors", () => {
  test("all colors are valid hex numbers", () => {
    for (const color of Object.values(Colors)) {
      expect(typeof color).toBe("number");
      expect(color).toBeGreaterThanOrEqual(0);
      expect(color).toBeLessThanOrEqual(0xffffff);
    }
  });
});

describe("INFRACTIONS_PER_PAGE", () => {
  test("is a positive number", () => {
    expect(INFRACTIONS_PER_PAGE).toBeGreaterThan(0);
  });
});
