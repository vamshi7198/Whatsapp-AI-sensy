import { describe, expect, it } from "vitest";

import {
  buildTemplateComponents,
  extractVariables,
  suggestTemplateName,
  validateTemplateDraft,
  type TemplateDraft,
} from "../builder";

const validDraft: TemplateDraft = {
  name: "order_shipped",
  language: "en",
  category: "UTILITY",
  bodyText: "Hi {{1}}, your order {{2}} has shipped.",
  examples: { "1": "Vamshi", "2": "UNC-10432" },
};

describe("extractVariables", () => {
  it("finds placeholders in order", () => {
    expect(extractVariables("Hi {{1}}, order {{2}} shipped")).toEqual(["1", "2"]);
  });

  it("de-duplicates repeated placeholders", () => {
    expect(extractVariables("{{1}} and {{1}} again")).toEqual(["1"]);
  });

  it("sorts numerically, not as text", () => {
    // String sorting would put "10" before "2".
    expect(
      extractVariables("{{1}} {{10}} {{2}}"),
    ).toEqual(["1", "2", "10"]);
  });

  it("tolerates spaces inside the braces", () => {
    expect(extractVariables("Hi {{ 1 }}")).toEqual(["1"]);
  });

  it("returns nothing when there are no placeholders", () => {
    expect(extractVariables("Your order shipped.")).toEqual([]);
  });
});

describe("validateTemplateDraft", () => {
  it("accepts a well-formed draft", () => {
    expect(validateTemplateDraft(validDraft)).toEqual([]);
  });

  /**
   * The rule that most often causes a silent rejection: Meta requires an
   * example for every variable, and the error it returns rarely mentions it.
   */
  it("requires an example for every variable", () => {
    const issues = validateTemplateDraft({
      ...validDraft,
      examples: { "1": "Vamshi" },
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("example_2");
    expect(issues[0].message).toMatch(/example of what \{\{2\}\}/);
  });

  it("treats a blank example as missing", () => {
    const issues = validateTemplateDraft({
      ...validDraft,
      examples: { "1": "Vamshi", "2": "   " },
    });
    expect(issues.some((i) => i.field === "example_2")).toBe(true);
  });

  it("rejects a name with capitals, spaces or punctuation", () => {
    for (const name of ["Order Shipped", "order-shipped", "OrderShipped", "order.shipped"]) {
      const issues = validateTemplateDraft({ ...validDraft, name });
      expect(issues.some((i) => i.field === "name")).toBe(true);
    }
  });

  it("accepts a valid name", () => {
    expect(
      validateTemplateDraft({ ...validDraft, name: "order_shipped_2024" }),
    ).toEqual([]);
  });

  it("rejects gaps in the numbering", () => {
    // Meta rejects {{1}} followed by {{3}}, with an error that does not
    // explain why.
    const issues = validateTemplateDraft({
      ...validDraft,
      bodyText: "Hi {{1}}, your order {{3}} shipped.",
      examples: { "1": "Vamshi", "3": "UNC-1" },
    });

    expect(issues.some((i) => i.message.includes("no gaps"))).toBe(true);
  });

  it("rejects a message that starts with a variable", () => {
    const issues = validateTemplateDraft({
      ...validDraft,
      bodyText: "{{1}}, your order has shipped.",
      examples: { "1": "Vamshi" },
    });

    expect(issues.some((i) => i.message.includes("cannot begin"))).toBe(true);
  });

  it("rejects a message that ends with a variable", () => {
    const issues = validateTemplateDraft({
      ...validDraft,
      bodyText: "Your order number is {{1}}",
      examples: { "1": "UNC-1" },
    });

    expect(issues.some((i) => i.message.includes("cannot end"))).toBe(true);
  });

  it("enforces length limits with the actual count", () => {
    const issues = validateTemplateDraft({
      ...validDraft,
      bodyText: `Hi ${"x".repeat(1100)} end`,
      examples: {},
    });

    const issue = issues.find((i) => i.field === "bodyText");
    expect(issue?.message).toMatch(/1024/);
    expect(issue?.message).toMatch(/\d{4} characters/);
  });

  it("enforces the 60-character header and footer limits", () => {
    expect(
      validateTemplateDraft({
        ...validDraft,
        headerText: "x".repeat(61),
      }).some((i) => i.field === "headerText"),
    ).toBe(true);

    expect(
      validateTemplateDraft({
        ...validDraft,
        footerText: "x".repeat(61),
      }).some((i) => i.field === "footerText"),
    ).toBe(true);
  });

  it("explains every problem without jargon", () => {
    const issues = validateTemplateDraft({
      name: "Bad Name",
      language: "en",
      category: "MARKETING",
      bodyText: "{{1}} hello",
      examples: {},
    });

    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.message).not.toMatch(/regex|\bnull\b|undefined|132\d\d\d/);
      expect(issue.message.length).toBeGreaterThan(10);
    }
  });
});

describe("buildTemplateComponents", () => {
  it("includes example values in the shape Meta expects", () => {
    const components = buildTemplateComponents(validDraft);
    const body = components.find((c) => c.type === "BODY");

    // Array of arrays: one inner array per example set.
    expect(body?.example).toEqual({
      body_text: [["Vamshi", "UNC-10432"]],
    });
  });

  it("orders example values by variable number, not insertion order", () => {
    const components = buildTemplateComponents({
      ...validDraft,
      bodyText: "Hi {{1}}, order {{2}}, total {{3}}.",
      // Deliberately out of order — object key order must not decide this.
      examples: { "3": "third", "1": "first", "2": "second" },
    });

    const body = components.find((c) => c.type === "BODY");
    expect(body?.example).toEqual({
      body_text: [["first", "second", "third"]],
    });
  });

  it("omits the example block when there are no variables", () => {
    const components = buildTemplateComponents({
      ...validDraft,
      bodyText: "Your order has shipped.",
      examples: {},
    });

    expect(components.find((c) => c.type === "BODY")?.example).toBeUndefined();
  });

  it("includes header and footer only when supplied", () => {
    const withAll = buildTemplateComponents({
      ...validDraft,
      headerText: "Order update",
      footerText: "Uncanned",
    });
    expect(withAll.map((c) => c.type)).toEqual(["HEADER", "BODY", "FOOTER"]);

    const bodyOnly = buildTemplateComponents(validDraft);
    expect(bodyOnly.map((c) => c.type)).toEqual(["BODY"]);
  });

  it("ignores whitespace-only header and footer", () => {
    const components = buildTemplateComponents({
      ...validDraft,
      headerText: "   ",
      footerText: "\n",
    });
    expect(components.map((c) => c.type)).toEqual(["BODY"]);
  });
});

describe("suggestTemplateName", () => {
  it("converts a human title into a valid name", () => {
    expect(suggestTemplateName("Order Shipped!")).toBe("order_shipped");
    expect(suggestTemplateName("Pilot Feedback – August 2026")).toBe(
      "pilot_feedback_august_2026",
    );
  });

  it("trims leading and trailing underscores", () => {
    expect(suggestTemplateName("  ...hello...  ")).toBe("hello");
  });

  it("always produces something valid", () => {
    for (const input of ["Order Shipped!", "!!!", "a b c", "ÜNSIDE Pilot"]) {
      const name = suggestTemplateName(input);
      if (name) expect(name).toMatch(/^[a-z0-9_]+$/);
    }
  });
});
