import { describe, expect, it } from "vitest";

import { templatesToDisable } from "../service";

const LOCAL = [
  { id: "t1", name: "pilot_invite", language: "en" },
  { id: "t2", name: "order_update", language: "en" },
  { id: "t3", name: "pilot_invite", language: "hi" },
];

const key = (name: string, language: string) => `${name}::${language}`;

describe("templatesToDisable", () => {
  it("disables a template Meta no longer lists", () => {
    const seen = new Set([key("pilot_invite", "en"), key("pilot_invite", "hi")]);

    expect(templatesToDisable(seen, LOCAL)).toEqual(["t2"]);
  });

  it("keeps everything Meta still lists", () => {
    const seen = new Set(LOCAL.map((t) => key(t.name, t.language)));

    expect(templatesToDisable(seen, LOCAL)).toEqual([]);
  });

  it("treats the same name in two languages as two templates", () => {
    const seen = new Set([key("pilot_invite", "en"), key("order_update", "en")]);

    // The Hindi one is gone, the English one is not.
    expect(templatesToDisable(seen, LOCAL)).toEqual(["t3"]);
  });

  describe("an empty sync must change nothing", () => {
    /*
      The finding this function was extracted for.

      client.ts turns an empty 200 body into {}, and the provider read
      `data.data ?? []` — so an edge-cached empty response, a Graph field
      rename, or a wabaId pointing at the wrong WABA all arrived here as "this
      account has no templates".

      The sweep then marked EVERY template DISABLED in one updateMany. The
      running campaign fails, every journey template step throws, auto-replies
      break — and the campaign's un-messaged recipients stay PENDING rather
      than FAILED, so the resend screen reports "nothing failed" and there is
      no path in the codebase left to reach them.
    */
    it("disables nothing when Meta returned no templates at all", () => {
      expect(templatesToDisable(new Set(), LOCAL)).toEqual([]);
    });

    it("is not fooled into thinking that is a normal delete", () => {
      // The naive reading — "none were seen, so all are gone" — is exactly
      // what this must never do.
      const naive = LOCAL.filter(
        (t) => !new Set<string>().has(key(t.name, t.language)),
      ).map((t) => t.id);

      expect(naive).toEqual(["t1", "t2", "t3"]); // what the old code did
      expect(templatesToDisable(new Set(), LOCAL)).toEqual([]); // what it does now
    });

    it("stays harmless when there is genuinely nothing either side", () => {
      expect(templatesToDisable(new Set(), [])).toEqual([]);
    });
  });
});
