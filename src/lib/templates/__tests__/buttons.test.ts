import { describe, expect, it } from "vitest";

import {
  buildTemplateComponents,
  validateButtons,
  type TemplateButton,
  type TemplateDraft,
} from "../builder";

const quick = (text: string): TemplateButton => ({
  type: "QUICK_REPLY",
  text,
});
const url = (text: string): TemplateButton => ({
  type: "URL",
  text,
  url: "https://uncanned.in",
});
const call = (text: string): TemplateButton => ({
  type: "PHONE_NUMBER",
  text,
  phoneNumber: "+919632929141",
});

describe("validateButtons", () => {
  it("accepts no buttons", () => {
    expect(validateButtons([])).toEqual([]);
  });

  it("accepts a simple valid set", () => {
    expect(validateButtons([quick("Yes"), quick("No")])).toEqual([]);
    expect(validateButtons([url("Track order")])).toEqual([]);
    expect(validateButtons([call("Call us")])).toEqual([]);
  });

  it("enforces the overall maximum of 10", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => quick(`Option ${i}`));
    expect(
      validateButtons(eleven).some((i) => i.message.includes("at most 10")),
    ).toBe(true);
  });

  it("allows at most two website buttons", () => {
    expect(validateButtons([url("A"), url("B")])).toEqual([]);
    expect(
      validateButtons([url("A"), url("B"), url("C")]).some((i) =>
        i.message.includes("2 website buttons"),
      ),
    ).toBe(true);
  });

  it("allows only one call button", () => {
    expect(
      validateButtons([call("A"), call("B")]).some((i) =>
        i.message.includes("1 call button"),
      ),
    ).toBe(true);
  });

  /**
   * The rule nobody expects: quick replies and action buttons must each be
   * contiguous. Meta rejects interleaving with an "invalid combination" error
   * that never says what was invalid.
   */
  it("rejects quick replies interleaved with action buttons", () => {
    const interleaved = [quick("Yes"), url("Track"), quick("No")];
    expect(
      validateButtons(interleaved).some((i) =>
        i.message.includes("alternate"),
      ),
    ).toBe(true);
  });

  it("accepts quick replies grouped before action buttons", () => {
    expect(validateButtons([quick("Yes"), quick("No"), url("Track")])).toEqual(
      [],
    );
  });

  it("accepts action buttons grouped before quick replies", () => {
    expect(validateButtons([url("Track"), quick("Yes"), quick("No")])).toEqual(
      [],
    );
  });

  it("requires a label on every button", () => {
    expect(
      validateButtons([quick("  ")]).some((i) => i.field === "button_0_text"),
    ).toBe(true);
  });

  it("caps label length at 25 characters", () => {
    expect(
      validateButtons([quick("x".repeat(26))]).some((i) =>
        i.message.includes("25"),
      ),
    ).toBe(true);
    expect(validateButtons([quick("x".repeat(25))])).toEqual([]);
  });

  it("requires a valid web address on a website button", () => {
    expect(
      validateButtons([{ type: "URL", text: "Go", url: "" }]).some(
        (i) => i.field === "button_0_url",
      ),
    ).toBe(true);

    expect(
      validateButtons([
        { type: "URL", text: "Go", url: "uncanned.in" },
      ]).some((i) => i.message.includes("https://")),
    ).toBe(true);
  });

  it("requires a number on a call button", () => {
    expect(
      validateButtons([
        { type: "PHONE_NUMBER", text: "Call", phoneNumber: "" },
      ]).some((i) => i.field === "button_0_phone"),
    ).toBe(true);
  });

  it("numbers buttons from 1 in its messages, not 0", () => {
    const issues = validateButtons([quick("ok"), quick("")]);
    expect(issues[0].message).toContain("Button 2");
  });
});

describe("buildTemplateComponents with buttons", () => {
  const base: TemplateDraft = {
    name: "order_shipped",
    language: "en",
    category: "UTILITY",
    bodyText: "Hi {{1}}, your order has shipped.",
    examples: { "1": "Vamshi" },
  };

  it("omits the BUTTONS component when there are none", () => {
    expect(
      buildTemplateComponents(base).find((c) => c.type === "BUTTONS"),
    ).toBeUndefined();
  });

  it("uses Meta's snake_case field for phone numbers", () => {
    const components = buildTemplateComponents({
      ...base,
      buttons: [call("Call us")],
    });

    const block = components.find((c) => c.type === "BUTTONS");
    // phone_number, not phoneNumber — Meta rejects the camelCase form.
    expect(block?.buttons?.[0]).toEqual({
      type: "PHONE_NUMBER",
      text: "Call us",
      phone_number: "+919632929141",
    });
  });

  it("keeps button order, which decides how they render", () => {
    const components = buildTemplateComponents({
      ...base,
      buttons: [url("Track"), quick("Yes"), quick("No")],
    });

    expect(
      components.find((c) => c.type === "BUTTONS")?.buttons?.map((b) => b.text),
    ).toEqual(["Track", "Yes", "No"]);
  });

  it("trims whitespace from labels and addresses", () => {
    const components = buildTemplateComponents({
      ...base,
      buttons: [{ type: "URL", text: "  Track  ", url: "  https://x.com  " }],
    });

    expect(components.find((c) => c.type === "BUTTONS")?.buttons?.[0]).toEqual({
      type: "URL",
      text: "Track",
      url: "https://x.com",
    });
  });

  it("places BUTTONS after the footer", () => {
    const components = buildTemplateComponents({
      ...base,
      headerText: "Order update",
      footerText: "Uncanned",
      buttons: [quick("Thanks")],
    });

    expect(components.map((c) => c.type)).toEqual([
      "HEADER",
      "BODY",
      "FOOTER",
      "BUTTONS",
    ]);
  });
});
