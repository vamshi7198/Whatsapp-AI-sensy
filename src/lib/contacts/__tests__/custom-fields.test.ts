import { describe, expect, it } from "vitest";

import { readCustomFields } from "../service";

/**
 * Contact.attributes is a JSON bag holding whatever an import carried beyond
 * name, phone, email and tags. It comes from a spreadsheet somebody made, so
 * this has to cope with the shapes a spreadsheet produces without a code
 * change every time a column is added.
 */
describe("readCustomFields", () => {
  it("returns the fields a CSV carried", () => {
    expect(
      readCustomFields({
        address: "plot no 76, Vijayasree Colony, LB Nagar",
        city: "Hyderabad",
      }),
    ).toEqual([
      ["address", "plot no 76, Vijayasree Colony, LB Nagar"],
      ["city", "Hyderabad"],
    ]);
  });

  it("takes new fields without being told about them", () => {
    // The requirement: next month's import gains AWB number and delivery
    // partner, and they appear with nothing edited.
    const fields = readCustomFields({
      "AWB number": "SF1234567890",
      "Delivery partner": "Shiprocket",
    });

    expect(fields).toEqual([
      ["AWB number", "SF1234567890"],
      ["Delivery partner", "Shiprocket"],
    ]);
  });

  it("orders by key, so a contact does not reshuffle between page loads", () => {
    // Postgres gives no ordering guarantee for JSON keys. Without sorting, the
    // same contact can present its fields differently each time it loads,
    // which reads as a bug.
    const keys = readCustomFields({
      zone: "south",
      address: "somewhere",
      city: "Hyderabad",
    }).map(([key]) => key);

    expect(keys).toEqual(["address", "city", "zone"]);
  });

  it("drops blanks, which an empty spreadsheet cell leaves behind", () => {
    expect(readCustomFields({ address: "", city: "   ", zone: "south" })).toEqual([
      ["zone", "south"],
    ]);
  });

  it("drops anything that is not text rather than showing [object Object]", () => {
    // Everything an import writes is a string, so a number or a nested object
    // arrived some other way. Rendering it raw helps nobody.
    expect(
      readCustomFields({
        good: "yes",
        count: 42,
        nested: { a: 1 },
        missing: null,
      }),
    ).toEqual([["good", "yes"]]);
  });

  it("survives a contact with no fields at all", () => {
    // A contact added by hand has attributes null, and this runs on every
    // contact page — it must not be the thing that breaks one.
    expect(readCustomFields(null)).toEqual([]);
    expect(readCustomFields(undefined)).toEqual([]);
    expect(readCustomFields({})).toEqual([]);
  });

  it("survives a value that is not an object", () => {
    expect(readCustomFields("not an object")).toEqual([]);
    expect(readCustomFields(["a", "b"])).toEqual([]);
    expect(readCustomFields(7)).toEqual([]);
  });
});
