import { describe, expect, it } from "vitest";

import { getTemplateHeaderMediaType } from "../service";

/**
 * A template whose header is media is rejected by Meta for every recipient if
 * the file is missing. Detecting it correctly is what turns that into a single
 * warning in the wizard rather than an entirely failed campaign.
 */
describe("getTemplateHeaderMediaType", () => {
  it("detects an image header", () => {
    expect(
      getTemplateHeaderMediaType([
        { type: "HEADER", format: "IMAGE" },
        { type: "BODY", text: "Hi {{1}}" },
      ]),
    ).toBe("image");
  });

  it("detects video and document headers", () => {
    expect(
      getTemplateHeaderMediaType([{ type: "HEADER", format: "VIDEO" }]),
    ).toBe("video");
    expect(
      getTemplateHeaderMediaType([{ type: "HEADER", format: "DOCUMENT" }]),
    ).toBe("document");
  });

  it("returns null for a text header, which needs no file", () => {
    expect(
      getTemplateHeaderMediaType([
        { type: "HEADER", format: "TEXT", text: "Order update" },
        { type: "BODY", text: "Hi {{1}}" },
      ]),
    ).toBeNull();
  });

  it("returns null when there is no header at all", () => {
    expect(
      getTemplateHeaderMediaType([{ type: "BODY", text: "Hi {{1}}" }]),
    ).toBeNull();
  });

  it("returns null for LOCATION headers, which take no upload", () => {
    expect(
      getTemplateHeaderMediaType([{ type: "HEADER", format: "LOCATION" }]),
    ).toBeNull();
  });

  it("copes with malformed input rather than throwing", () => {
    expect(getTemplateHeaderMediaType(null)).toBeNull();
    expect(getTemplateHeaderMediaType(undefined)).toBeNull();
    expect(getTemplateHeaderMediaType([])).toBeNull();
    expect(getTemplateHeaderMediaType("not an array")).toBeNull();
  });

  it("ignores a header with no format", () => {
    expect(getTemplateHeaderMediaType([{ type: "HEADER" }])).toBeNull();
  });
});
