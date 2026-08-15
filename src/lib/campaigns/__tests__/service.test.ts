import { describe, expect, it } from "vitest";

import { isStopped } from "../service";

/**
 * Which campaign statuses mean "this will not send any more on its own".
 *
 * This decides whether a PENDING recipient is treated as "not yet" or as
 * "never reached". Getting it wrong in one direction hides people a resend
 * should reach; in the other it would resend to people still in the queue,
 * messaging them twice.
 */
describe("isStopped", () => {
  it("treats every terminal status as stopped", () => {
    for (const status of [
      "COMPLETED",
      "PARTIALLY_FAILED",
      "FAILED",
      "CANCELLED",
    ]) {
      expect(isStopped(status)).toBe(true);
    }
  });

  it("treats anything that may still send as not stopped", () => {
    // The important half. If RUNNING were ever counted as stopped, a resend
    // would copy recipients the live campaign is about to message, and both
    // would go out.
    for (const status of ["DRAFT", "SCHEDULED", "QUEUED", "RUNNING"]) {
      expect(isStopped(status)).toBe(false);
    }
  });

  it("covers every status in the schema", () => {
    // A new CampaignStatus added to the enum without a decision here would
    // silently fall into "not stopped" and hide stranded recipients again.
    const all = [
      "DRAFT",
      "SCHEDULED",
      "QUEUED",
      "RUNNING",
      "COMPLETED",
      "PARTIALLY_FAILED",
      "FAILED",
      "CANCELLED",
    ];

    expect(all.filter(isStopped)).toEqual([
      "COMPLETED",
      "PARTIALLY_FAILED",
      "FAILED",
      "CANCELLED",
    ]);
  });
});
