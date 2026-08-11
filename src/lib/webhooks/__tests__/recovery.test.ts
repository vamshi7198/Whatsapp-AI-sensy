import { describe, expect, it } from "vitest";

import { parseMetaWebhook } from "../../whatsapp/providers/meta/mappers";

/*
  The recovery path re-reads a stored webhook payload and applies it. That only
  works if what was STORED is what the parser can READ.

  It once was not: the inner message object was stored, while the parser
  requires the full envelope. Recovery therefore found nothing, silently, in
  the one code path whose entire purpose is not losing a customer's message.

  These tests pin the contract from both ends.
*/

const ENVELOPE = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA",
      changes: [
        {
          field: "messages",
          value: {
            contacts: [{ profile: { name: "Vamshi" }, wa_id: "919876543210" }],
            messages: [
              {
                id: "wamid.RECOVER",
                from: "919876543210",
                timestamp: "1754400000",
                type: "text",
                text: { body: "Is my order out for delivery?" },
              },
            ],
          },
        },
      ],
    },
  ],
};

describe("webhook payload round trip", () => {
  it("re-reads a stored full payload into the same event", () => {
    const [original] = parseMetaWebhook(ENVELOPE);

    // What recovery does: parse what was written to the database.
    const stored = JSON.parse(JSON.stringify(ENVELOPE));
    const [recovered] = parseMetaWebhook(stored);

    expect(recovered).toMatchObject({
      kind: "inbound_message",
      externalMessageId: "wamid.RECOVER",
      from: "+919876543210",
      contactName: "Vamshi",
      text: "Is my order out for delivery?",
    });

    expect(recovered.kind).toBe(original.kind);
  });

  it("cannot re-read a bare inner message — the bug this guards against", () => {
    // Storing event.raw rather than the whole body produced exactly this, and
    // nothing anywhere reported a problem.
    const innerOnly = ENVELOPE.entry[0].changes[0].value.messages[0];
    const [result] = parseMetaWebhook(innerOnly);

    expect(result.kind).toBe("unknown");
  });

  it("survives the JSON round trip the database imposes", () => {
    // Dates and undefined do not survive a column; the payload must still be
    // readable after Postgres has been through it.
    const [before] = parseMetaWebhook(ENVELOPE);
    const [after] = parseMetaWebhook(JSON.parse(JSON.stringify(ENVELOPE)));

    expect(after).toMatchObject({
      kind: before.kind,
      externalMessageId: "wamid.RECOVER",
    });
  });
});
