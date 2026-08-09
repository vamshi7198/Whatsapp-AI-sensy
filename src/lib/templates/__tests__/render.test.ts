import { describe, expect, it } from "vitest";

import {
  getTemplateBody,
  getTemplateButtons,
  getTemplateFooter,
  getTemplateHeader,
  renderTemplateBody,
} from "../service";

const COMPONENTS = [
  { type: "HEADER", format: "TEXT", text: "Order {{1}}" },
  { type: "BODY", text: "Hello {{1}}, your order {{2}} has shipped." },
  { type: "FOOTER", text: "Uncanned" },
  {
    type: "BUTTONS",
    buttons: [{ type: "URL", text: "Track order", url: "https://x" }],
  },
];

describe("template component extraction", () => {
  it("pulls out each part", () => {
    expect(getTemplateBody(COMPONENTS)).toContain("Hello {{1}}");
    expect(getTemplateHeader(COMPONENTS)?.text).toBe("Order {{1}}");
    expect(getTemplateFooter(COMPONENTS)).toBe("Uncanned");
    expect(getTemplateButtons(COMPONENTS)).toHaveLength(1);
  });

  it("copes with missing parts and bad input", () => {
    expect(getTemplateBody([])).toBe("");
    expect(getTemplateHeader([])).toBeNull();
    expect(getTemplateFooter(null)).toBe("");
    expect(getTemplateButtons(undefined)).toEqual([]);
  });
});

describe("renderTemplateBody", () => {
  const body = "Hello {{1}}, your order {{2}} has shipped.";

  it("substitutes supplied values", () => {
    expect(renderTemplateBody(body, { "1": "Vamshi", "2": "UNC-10432" })).toBe(
      "Hello Vamshi, your order UNC-10432 has shipped.",
    );
  });

  it("leaves a missing value visible rather than blanking it", () => {
    // An operator previewing a campaign must be able to see at a glance that
    // a value is missing, not read a sentence with a silent hole in it.
    const result = renderTemplateBody(body, { "1": "Vamshi" });
    expect(result).toBe("Hello Vamshi, your order {{2}} has shipped.");
    expect(result).toContain("{{2}}");
  });

  it("treats an empty string as missing", () => {
    expect(renderTemplateBody(body, { "1": "", "2": "UNC-1" })).toContain(
      "{{1}}",
    );
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderTemplateBody("Hi {{ 1 }}", { "1": "Vamshi" })).toBe(
      "Hi Vamshi",
    );
  });

  it("replaces every occurrence of the same placeholder", () => {
    expect(
      renderTemplateBody("{{1}} and {{1}} again", { "1": "X" }),
    ).toBe("X and X again");
  });

  it("does not treat a replacement value as a pattern", () => {
    // A value like "$&" would otherwise be interpreted by String.replace and
    // corrupt the message.
    expect(renderTemplateBody("Hi {{1}}", { "1": "$& $1 $`" })).toBe(
      "Hi $& $1 $`",
    );
  });

  it("returns the body unchanged when it has no placeholders", () => {
    expect(renderTemplateBody("Your order shipped.", { "1": "X" })).toBe(
      "Your order shipped.",
    );
  });
});
