import { describe, expect, it } from "vitest";

import { matchesKeyword, type KeywordConfig } from "../engine";

/*
  Keyword matching decides whether a real customer gets an unprompted message,
  so the cases that matter most are the ones where it should NOT fire.
*/

function contains(...keywords: string[]): KeywordConfig {
  return { keywords, matchType: "contains" };
}

function exact(...keywords: string[]): KeywordConfig {
  return { keywords, matchType: "exact" };
}

describe("matchesKeyword — contains", () => {
  it("fires when the word appears in a sentence", () => {
    expect(matchesKeyword("where is my order", contains("order"))).toBe(true);
    expect(matchesKeyword("Can I TRACK this?", contains("track"))).toBe(true);
  });

  it("does not fire on a word that merely contains the keyword", () => {
    // The failure that would embarrass us: "backtrack" is not "track".
    expect(matchesKeyword("please backtrack on that", contains("track"))).toBe(
      false,
    );
    expect(matchesKeyword("reorder it for me", contains("order"))).toBe(false);
    expect(matchesKeyword("disorder", contains("order"))).toBe(false);
  });

  it("fires on any one of several keywords", () => {
    const config = contains("track", "status", "where is my order");
    expect(matchesKeyword("what is the status", config)).toBe(true);
    expect(matchesKeyword("nothing relevant here", config)).toBe(false);
  });

  it("handles punctuation around the word", () => {
    expect(matchesKeyword("track, please", contains("track"))).toBe(true);
    expect(matchesKeyword("is it shipped?", contains("shipped"))).toBe(true);
  });

  it("treats a keyword with regex characters literally", () => {
    // A keyword like "10% off" must not be compiled as a pattern.
    expect(matchesKeyword("do you have 10% off", contains("10% off"))).toBe(
      true,
    );
    expect(matchesKeyword("anything at all", contains("a.*b"))).toBe(false);
  });
});

describe("matchesKeyword — exact", () => {
  it("fires only on the whole message", () => {
    expect(matchesKeyword("track", exact("track"))).toBe(true);
    expect(matchesKeyword("  TRACK  ", exact("track"))).toBe(true);
    expect(matchesKeyword("track my order", exact("track"))).toBe(false);
  });

  it("ignores trailing punctuation", () => {
    expect(matchesKeyword("track!", exact("track"))).toBe(true);
    expect(matchesKeyword("track.", exact("track"))).toBe(true);
    expect(matchesKeyword("track?", exact("track"))).toBe(true);
  });
});

describe("matchesKeyword — nothing to match", () => {
  it("never fires on an empty message", () => {
    expect(matchesKeyword("", contains("track"))).toBe(false);
    expect(matchesKeyword("   ", contains("track"))).toBe(false);
  });

  it("never fires when no keywords are configured", () => {
    expect(matchesKeyword("anything", contains())).toBe(false);
    expect(matchesKeyword("anything", contains("", "  "))).toBe(false);
  });
});
