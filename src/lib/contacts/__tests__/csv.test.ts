import { describe, expect, it } from "vitest";

import {
  escapeCsvCell,
  parseContactCsv,
  parseTags,
  suggestMapping,
  type ColumnMapping,
} from "../csv";

const MAPPING: ColumnMapping = {
  name: "name",
  phone: "phone",
  email: "email",
  tags: "tags",
};

describe("suggestMapping", () => {
  it("recognises the brief's column names", () => {
    expect(suggestMapping(["name", "phone", "email", "tags"])).toEqual({
      name: "name",
      phone: "phone",
      email: "email",
      tags: "tags",
    });
  });

  it("recognises aliases from real exports", () => {
    const result = suggestMapping([
      "Full Name",
      "WhatsApp Number",
      "E-Mail",
      "Labels",
    ]);
    expect(result.name).toBe("Full Name");
    expect(result.phone).toBe("WhatsApp Number");
    expect(result.email).toBe("E-Mail");
    expect(result.tags).toBe("Labels");
  });

  it("omits fields it cannot identify", () => {
    expect(suggestMapping(["col_a", "col_b"])).toEqual({});
  });
});

describe("parseTags", () => {
  it("splits on comma, semicolon and pipe, and lowercases", () => {
    expect(parseTags("Pilot, Influencer")).toEqual(["pilot", "influencer"]);
    expect(parseTags("pilot;hyderabad")).toEqual(["pilot", "hyderabad"]);
    expect(parseTags("pilot|customer")).toEqual(["pilot", "customer"]);
  });

  it("handles empty values", () => {
    expect(parseTags("")).toEqual([]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags(" , , ")).toEqual([]);
  });
});

describe("parseContactCsv", () => {
  it("parses the example from the brief", () => {
    const csv = [
      "name,phone,email,tags",
      "Vamshi,+919876543210,vamshi@email.com,pilot",
      "Rahul,+919876543211,rahul@email.com,influencer",
    ].join("\n");

    const result = parseContactCsv(csv, MAPPING);

    expect(result.rows).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({
      name: "Vamshi",
      phoneE164: "+919876543210",
      phoneCountry: "IN",
      email: "vamshi@email.com",
      tags: ["pilot"],
    });
  });

  it("normalises mixed phone formats to E.164", () => {
    const csv = [
      "name,phone",
      "A,9876543210",
      "B,09876543211",
      "C,+91 98765 43212",
    ].join("\n");

    const result = parseContactCsv(csv, { name: "name", phone: "phone" });

    expect(result.rows.map((r) => r.phoneE164)).toEqual([
      "+919876543210",
      "+919876543211",
      "+919876543212",
    ]);
  });

  it("collapses duplicates within the file and counts them", () => {
    const csv = [
      "name,phone",
      "Vamshi,+919876543210",
      "Vamshi Again,9876543210", // same number, different spelling
    ].join("\n");

    const result = parseContactCsv(csv, { name: "name", phone: "phone" });

    expect(result.rows).toHaveLength(1);
    expect(result.duplicatesInFile).toBe(1);
    // Last row wins, so a corrected later entry takes effect.
    expect(result.rows[0].name).toBe("Vamshi Again");
  });

  it("reports invalid phone rows with their line number and keeps the rest", () => {
    const csv = [
      "name,phone",
      "Good,+919876543210",
      "Bad,not-a-number",
      "AlsoGood,+919876543211",
    ].join("\n");

    const result = parseContactCsv(csv, { name: "name", phone: "phone" });

    expect(result.rows).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    // Line 3: header is line 1, "Good" is line 2.
    expect(result.errors[0].line).toBe(3);
    expect(result.errors[0].rawPhone).toBe("not-a-number");
  });

  it("keeps the contact when only the email is invalid, but says so", () => {
    const csv = ["name,phone,email", "Vamshi,+919876543210,not-an-email"].join(
      "\n",
    );

    const result = parseContactCsv(csv, {
      name: "name",
      phone: "phone",
      email: "email",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].email).toBeNull();
    expect(result.errors[0].reason).toMatch(/still imported/i);
  });

  it("keeps unmapped columns as attributes for template variables", () => {
    const csv = [
      "name,phone,order_id,city",
      "Vamshi,+919876543210,UNC-10432,Hyderabad",
    ].join("\n");

    const result = parseContactCsv(csv, { name: "name", phone: "phone" });

    expect(result.rows[0].attributes).toEqual({
      order_id: "UNC-10432",
      city: "Hyderabad",
    });
  });

  it("skips blank lines without reporting them as errors", () => {
    const csv = [
      "name,phone",
      "Vamshi,+919876543210",
      "",
      "   ",
      "Rahul,+919876543211",
    ].join("\n");

    const result = parseContactCsv(csv, { name: "name", phone: "phone" });

    expect(result.rows).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });
});

describe("escapeCsvCell", () => {
  it("neutralises formula injection on export", () => {
    expect(escapeCsvCell('=HYPERLINK("http://evil","click")')).toBe(
      "'=HYPERLINK(\"http://evil\",\"click\")",
    );
    expect(escapeCsvCell("+1234")).toBe("'+1234");
    expect(escapeCsvCell("-1234")).toBe("'-1234");
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("leaves ordinary values untouched", () => {
    expect(escapeCsvCell("Vamshi")).toBe("Vamshi");
    expect(escapeCsvCell("vamshi@email.com")).toBe("vamshi@email.com");
  });

  it("returns an empty string for null and undefined", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("does not mangle a phone number that legitimately starts with +", () => {
    // Escaped for safety; the leading quote is a display artefact in Excel,
    // and the value survives a round-trip.
    expect(escapeCsvCell("+919876543210")).toBe("'+919876543210");
  });
});
