import { describe, expect, test } from "bun:test";
import { chunk } from "../../src/lib/chunk";

describe("chunk", () => {
  test("returns an empty array for no items", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  test("returns a single group when there are fewer items than the size", () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });

  test("splits evenly on an exact multiple of the size", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test("puts the remainder in a final smaller group", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test("size of 1 yields one item per group", () => {
    expect(chunk(["a", "b", "c"], 1)).toEqual([["a"], ["b"], ["c"]]);
  });

  test("throws on a non-positive size instead of looping forever", () => {
    expect(() => chunk([1, 2], 0)).toThrow(RangeError);
    expect(() => chunk([1, 2], -1)).toThrow();
  });
});
