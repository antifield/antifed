import { describe, expect, test } from "bun:test";
import { dmEmbed, errorEmbed, infoEmbed, modEmbed, successEmbed } from "../../src/lib/embeds";
import { Colors } from "../../src/lib/constants";

describe("modEmbed", () => {
  test("creates embed with author, description, color", () => {
    const embed = modEmbed({
      title: "Test",
      description: "Test description",
      color: Colors.Ban,
    });

    const json = embed.toJSON();
    expect(json.author?.name).toBe("Test");
    expect(json.description).toContain("Test description");
    expect(json.color).toBe(Colors.Ban);
    expect(json.timestamp).toBeDefined();
    expect(json.footer).toBeUndefined();
  });

  test("inlines fields into description", () => {
    const embed = modEmbed({
      title: "Test",
      description: "desc",
      color: Colors.Info,
      fields: [{ name: "Reason", value: "Testing" }],
    });

    const json = embed.toJSON();
    expect(json.description).toContain("**Reason:** Testing");
  });

  test("sets moderator in footer when provided", () => {
    const mockUser = {
      username: "testmod",
      displayAvatarURL: () => "https://example.com/avatar.png",
    } as any;

    const embed = modEmbed({
      title: "Test",
      description: "desc",
      color: Colors.Info,
      moderator: mockUser,
    });

    const json = embed.toJSON();
    expect(json.footer?.text).toBe("testmod");
  });
});

describe("dmEmbed", () => {
  test("creates embed with server name in footer", () => {
    const embed = dmEmbed({
      title: "You have been warned",
      description: "Rule 1",
      color: Colors.Warn,
      serverName: "Test Server",
    });

    const json = embed.toJSON();
    expect(json.author?.name).toBe("You have been warned");
    expect(json.footer?.text).toBe("Test Server");
    expect(json.color).toBe(Colors.Warn);
  });

  test("inlines fields into description", () => {
    const embed = dmEmbed({
      title: "Banned",
      description: "Rule 1",
      color: Colors.Ban,
      serverName: "Test",
      fields: [{ name: "Duration", value: "7 days" }],
    });

    const json = embed.toJSON();
    expect(json.description).toContain("**Duration:** 7 days");
  });
});

describe("errorEmbed", () => {
  test("uses error color with indicator", () => {
    const embed = errorEmbed("Something went wrong");
    const json = embed.toJSON();
    expect(json.color).toBe(Colors.Error);
    expect(json.description).toContain("Something went wrong");
  });
});

describe("successEmbed", () => {
  test("uses success color with indicator", () => {
    const embed = successEmbed("Done!");
    const json = embed.toJSON();
    expect(json.color).toBe(Colors.Success);
    expect(json.description).toContain("Done!");
  });
});

describe("infoEmbed", () => {
  test("uses info color", () => {
    const embed = infoEmbed("FYI");
    const json = embed.toJSON();
    expect(json.color).toBe(Colors.Info);
    expect(json.description).toBe("FYI");
  });
});
