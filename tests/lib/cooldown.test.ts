import { describe, expect, test } from "bun:test";
import { Cooldown } from "../../src/lib/cooldown";

describe("Cooldown", () => {
  test("claim succeeds when free and fails within the window", () => {
    const cd = new Cooldown(1000);
    expect(cd.claim("a", 0)).toBe(true);
    expect(cd.claim("a", 500)).toBe(false);
    expect(cd.claim("a", 1000)).toBe(true); // window elapsed -> claimable again
  });

  test("remaining counts down and reports 0 once elapsed", () => {
    const cd = new Cooldown(1000);
    cd.start("a", 0);
    expect(cd.remaining("a", 0)).toBe(1000);
    expect(cd.remaining("a", 400)).toBe(600);
    expect(cd.remaining("a", 1000)).toBe(0);
    expect(cd.remaining("missing", 0)).toBe(0);
  });

  test("isReady reflects the window", () => {
    const cd = new Cooldown(1000);
    expect(cd.isReady("a", 0)).toBe(true);
    cd.start("a", 0);
    expect(cd.isReady("a", 500)).toBe(false);
    expect(cd.isReady("a", 1000)).toBe(true);
  });

  test("clear releases a key immediately", () => {
    const cd = new Cooldown(1000);
    cd.start("a", 0);
    expect(cd.isReady("a", 100)).toBe(false);
    cd.clear("a");
    expect(cd.isReady("a", 100)).toBe(true);
  });

  test("does not leak: distinct keys evict once their windows pass", () => {
    const cd = new Cooldown(1000);
    // Claim 2000 distinct keys at t=0 (past the sweep threshold), then claim one
    // more well after the window — the sweep drops the expired ones.
    for (let i = 0; i < 2000; i++) cd.claim(`k${i}`, 0);
    cd.claim("late", 5000);
    expect(cd.size).toBeLessThan(2000);
  });
});
