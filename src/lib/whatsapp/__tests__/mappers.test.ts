import { describe, expect, it } from "vitest";

import {
  buildTemplateComponents,
  countTemplateVariables,
  parseMetaWebhook,
  toProviderTemplate,
  toRecipient,
} from "../providers/meta/mappers";

describe("toRecipient", () => {
  it("strips the leading + that Meta's API rejects", () => {
    expect(toRecipient("+919876543210")).toBe("919876543210");
    expect(toRecipient("919876543210")).toBe("919876543210");
  });
});

describe("countTemplateVariables", () => {
  it("counts positional placeholders in the body", () => {
    expect(
      countTemplateVariables([
        { type: "BODY", text: "Hello {{1}}, your order {{2}} has shipped." },
      ]),
    ).toBe(2);
  });

  it("returns the highest index, not the match count", () => {
    // "{{1}} ... {{1}} ... {{3}}" still needs three parameters supplied.
    expect(
      countTemplateVariables([
        { type: "BODY", text: "{{1}} and {{1}} again, plus {{3}}" },
      ]),
    ).toBe(3);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(
      countTemplateVariables([{ type: "BODY", text: "Hi {{ 1 }}" }]),
    ).toBe(1);
  });

  it("returns 0 for a template with no variables", () => {
    expect(
      countTemplateVariables([{ type: "BODY", text: "Your order shipped." }]),
    ).toBe(0);
    expect(countTemplateVariables([])).toBe(0);
  });
});

describe("buildTemplateComponents", () => {
  it("orders parameters numerically, not lexicographically", () => {
    // Object key order would put "10" before "2" and silently send the wrong
    // values into the wrong placeholders.
    const components = buildTemplateComponents({
      "1": "one",
      "2": "two",
      "10": "ten",
    });

    const body = components.find((c) => c.type === "body");
    expect(body?.parameters).toEqual([
      { type: "text", text: "one" },
      { type: "text", text: "two" },
      { type: "text", text: "ten" },
    ]);
  });

  it("omits components when there are no variables", () => {
    expect(buildTemplateComponents()).toEqual([]);
    expect(buildTemplateComponents({})).toEqual([]);
  });

  it("includes a header component when header variables are given", () => {
    const components = buildTemplateComponents({ "1": "body" }, { "1": "head" });
    expect(components.map((c) => c.type)).toEqual(["header", "body"]);
  });
});

describe("toProviderTemplate", () => {
  it("maps an approved template", () => {
    const result = toProviderTemplate({
      id: "123",
      name: "shipping_update",
      language: "en",
      category: "UTILITY",
      status: "APPROVED",
      components: [{ type: "BODY", text: "Hi {{1}}" }],
    });

    expect(result).toMatchObject({
      id: "123",
      name: "shipping_update",
      category: "UTILITY",
      status: "APPROVED",
    });
  });

  it("treats an unrecognised status as unusable rather than sendable", () => {
    const result = toProviderTemplate({
      id: "1",
      name: "x",
      language: "en",
      category: "UTILITY",
      status: "SOME_NEW_META_STATUS",
    });

    expect(result.status).toBe("DISABLED");
    expect(result.status).not.toBe("APPROVED");
  });

  it("maps in-review statuses to PENDING", () => {
    for (const status of ["PENDING", "IN_APPEAL", "PENDING_DELETION"]) {
      expect(
        toProviderTemplate({
          id: "1",
          name: "x",
          language: "en",
          category: "UTILITY",
          status,
        }).status,
      ).toBe("PENDING");
    }
  });

  it("maps the legacy OTP category to AUTHENTICATION", () => {
    expect(
      toProviderTemplate({
        id: "1",
        name: "x",
        language: "en",
        category: "OTP",
        status: "APPROVED",
      }).category,
    ).toBe("AUTHENTICATION");
  });
});

describe("parseMetaWebhook", () => {
  it("parses an inbound text message", () => {
    const events = parseMetaWebhook({
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
                    id: "wamid.ABC",
                    from: "919876543210",
                    timestamp: "1754400000",
                    type: "text",
                    text: { body: "Where is my order?" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "inbound_message",
      externalMessageId: "wamid.ABC",
      from: "+919876543210",
      contactName: "Vamshi",
      text: "Where is my order?",
    });
  });

  /*
    A journey branches on what the customer tapped, so reading the right
    identifier is what decides whether they get the right next message.
    Labels get reworded; ids do not.
  */
  function inbound(message: Record<string, unknown>) {
    return parseMetaWebhook({
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  {
                    id: "wamid.REPLY",
                    from: "919876543210",
                    timestamp: "1754400000",
                    ...message,
                  },
                ],
              },
            },
          ],
        },
      ],
    })[0];
  }

  it("reads our own id from a tapped button, not its label", () => {
    const event = inbound({
      type: "interactive",
      interactive: {
        type: "button_reply",
        button_reply: { id: "claim_sample", title: "Yes, I want a free sample" },
      },
    });

    expect(event).toMatchObject({
      kind: "inbound_message",
      reply: {
        id: "claim_sample",
        title: "Yes, I want a free sample",
        source: "button",
      },
    });
  });

  it("reads our own id from a menu selection", () => {
    const event = inbound({
      type: "interactive",
      interactive: {
        type: "list_reply",
        list_reply: { id: "flavour_cola", title: "Classic Cola" },
      },
    });

    expect(event).toMatchObject({
      reply: { id: "flavour_cola", title: "Classic Cola", source: "list" },
    });
  });

  it("falls back to the text for a template's own button", () => {
    // Meta sends no id for these — the button was fixed at approval time —
    // so the visible text is all there is to branch on.
    const event = inbound({
      type: "button",
      button: { text: "Not interested", payload: "Not interested" },
    });

    expect(event).toMatchObject({
      reply: {
        id: "Not interested",
        title: "Not interested",
        source: "template_button",
      },
    });
  });

  it("reports no reply for an ordinary message", () => {
    const event = inbound({ type: "text", text: { body: "hello" } });

    expect(event).toMatchObject({ kind: "inbound_message", text: "hello" });
    expect(event).not.toHaveProperty("reply");
  });

  it("parses a delivery status with pricing", () => {
    const events = parseMetaWebhook({
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                statuses: [
                  {
                    id: "wamid.ABC",
                    recipient_id: "919876543210",
                    status: "delivered",
                    timestamp: "1754400000",
                    pricing: { billable: true, category: "marketing" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(events[0]).toMatchObject({
      kind: "status_update",
      status: "delivered",
      pricingCategory: "marketing",
      billable: true,
    });
  });

  it("classifies a failed status into a plain-English error", () => {
    const events = parseMetaWebhook({
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                statuses: [
                  {
                    id: "wamid.FAIL",
                    recipient_id: "919876543210",
                    status: "failed",
                    timestamp: "1754400000",
                    errors: [
                      { code: 131026, title: "Message undeliverable" },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const event = events[0];
    expect(event.kind).toBe("status_update");
    if (event.kind === "status_update") {
      expect(event.error?.userMessage).toMatch(/not registered on WhatsApp/i);
      expect(event.error?.retryable).toBe(false);
    }
  });

  it("parses a template status update", () => {
    const events = parseMetaWebhook({
      entry: [
        {
          changes: [
            {
              field: "message_template_status_update",
              value: {
                event: "REJECTED",
                message_template_name: "promo_august",
                message_template_language: "en",
                reason: "ABUSIVE_CONTENT",
              },
            },
          ],
        },
      ],
    });

    expect(events[0]).toMatchObject({
      kind: "template_status",
      templateName: "promo_august",
      status: "REJECTED",
      reason: "ABUSIVE_CONTENT",
    });
  });

  it("emits several events from one payload", () => {
    const events = parseMetaWebhook({
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                statuses: [
                  { id: "w1", recipient_id: "91987", status: "sent", timestamp: "1754400000" },
                  { id: "w2", recipient_id: "91988", status: "read", timestamp: "1754400001" },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(events).toHaveLength(2);
  });

  it("never throws on an unexpected payload", () => {
    expect(parseMetaWebhook({})).toEqual([{ kind: "unknown", raw: {} }]);
    expect(parseMetaWebhook(null)[0].kind).toBe("unknown");
    expect(parseMetaWebhook({ entry: [{ changes: [{}] }] })[0].kind).toBe(
      "unknown",
    );
  });
});
