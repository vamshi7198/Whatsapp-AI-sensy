import { describe, expect, it } from "vitest";

import {
  MAX_VARIABLE_LENGTH,
  resolveVariables,
  sanitiseVariableValue,
  validateVariableValue,
  type AudienceMember,
  type VariableMapping,
} from "../audience";

const member: AudienceMember = {
  contactId: "c1",
  phoneE164: "+919876543210",
  name: "Vamshi",
  email: "vamshi@email.com",
  attributes: { order_id: "UNC-10432", city: "Hyderabad" },
  tags: ["pilot"],
};

describe("resolveVariables", () => {
  it("resolves contact fields, attributes and fixed values", () => {
    const mapping: VariableMapping = {
      "1": { source: "contact_field", field: "name" },
      "2": { source: "attribute", key: "order_id" },
      "3": { source: "fixed", value: "August" },
    };

    const { values, missing } = resolveVariables(member, mapping);

    expect(values).toEqual({
      "1": "Vamshi",
      "2": "UNC-10432",
      "3": "August",
    });
    expect(missing).toEqual([]);
  });

  it("reports a missing attribute instead of sending a blank", () => {
    const { values, missing } = resolveVariables(member, {
      "1": { source: "attribute", key: "tracking_number" },
    });

    expect(values).toEqual({});
    expect(missing).toEqual(["1"]);
  });

  it("treats an empty or whitespace-only value as missing", () => {
    const blank: AudienceMember = { ...member, name: "   " };
    const { missing } = resolveVariables(blank, {
      "1": { source: "contact_field", field: "name" },
    });

    expect(missing).toEqual(["1"]);
  });

  it("treats a null contact field as missing", () => {
    const noEmail: AudienceMember = { ...member, email: null };
    const { missing } = resolveVariables(noEmail, {
      "1": { source: "contact_field", field: "email" },
    });

    expect(missing).toEqual(["1"]);
  });

  it("trims resolved values", () => {
    const padded: AudienceMember = { ...member, name: "  Vamshi  " };
    const { values } = resolveVariables(padded, {
      "1": { source: "contact_field", field: "name" },
    });

    expect(values["1"]).toBe("Vamshi");
  });

  it("resolves several recipients independently", () => {
    const other: AudienceMember = {
      ...member,
      name: "Rahul",
      attributes: { order_id: "UNC-99" },
    };

    const mapping: VariableMapping = {
      "1": { source: "contact_field", field: "name" },
      "2": { source: "attribute", key: "order_id" },
    };

    expect(resolveVariables(member, mapping).values["2"]).toBe("UNC-10432");
    expect(resolveVariables(other, mapping).values["2"]).toBe("UNC-99");
  });
});

/**
 * Meta rejects these at send time. Catching them at mapping time is the
 * difference between one clear warning and every message in a 500-recipient
 * campaign failing identically.
 */
describe("validateVariableValue", () => {
  it("accepts ordinary values", () => {
    expect(validateVariableValue("Vamshi")).toBeNull();
    expect(validateVariableValue("UNC-10432")).toBeNull();
    expect(validateVariableValue("Hello there, friend!")).toBeNull();
  });

  it("rejects line breaks", () => {
    expect(validateVariableValue("Line one\nLine two")).toMatch(/line break/i);
    expect(validateVariableValue("Line one\r\nLine two")).toMatch(/line break/i);
  });

  it("rejects tabs", () => {
    expect(validateVariableValue("Name\tSurname")).toMatch(/tab/i);
  });

  it("rejects four or more consecutive spaces", () => {
    expect(validateVariableValue("A    B")).toMatch(/spaces in a row/i);
    // Three is fine — Meta's limit is four.
    expect(validateVariableValue("A   B")).toBeNull();
  });

  it("rejects values over the length limit", () => {
    expect(validateVariableValue("x".repeat(MAX_VARIABLE_LENGTH))).toBeNull();
    expect(validateVariableValue("x".repeat(MAX_VARIABLE_LENGTH + 1))).toMatch(
      /too long/i,
    );
  });

  it("explains the problem without jargon", () => {
    const problems = ["a\nb", "a\tb", "a    b", "x".repeat(2000)];
    for (const value of problems) {
      const error = validateVariableValue(value);
      expect(error).not.toBeNull();
      expect(error).not.toMatch(/regex|\\n|\\t|132\d\d\d/);
    }
  });
});

/**
 * The journey counterpart: same rules, applied rather than reported.
 *
 * A campaign variable comes from a mapped column and an operator can fix it.
 * A journey variable is whatever the customer just typed, with nobody watching
 * — so the choice is between tidying the value and ending the conversation.
 */
describe("sanitiseVariableValue", () => {
  it("leaves an ordinary value untouched", () => {
    expect(sanitiseVariableValue("Vamshi")).toBe("Vamshi");
    expect(sanitiseVariableValue("UNC-10432")).toBe("UNC-10432");
  });

  it("turns a two-line address into something Meta accepts", () => {
    // The case that matters. Writing an address across lines is normal, and
    // it used to fail the send and kill the session.
    const typed = "Flat 4B, Sunrise Apartments\nSector 12, Hyderabad";

    const result = sanitiseVariableValue(typed);

    expect(validateVariableValue(result)).toBeNull();
    expect(result).toBe("Flat 4B, Sunrise Apartments Sector 12, Hyderabad");
  });

  it("handles Windows line endings without leaving a double space", () => {
    expect(sanitiseVariableValue("one\r\ntwo")).toBe("one two");
  });

  it("collapses tabs and long space runs", () => {
    expect(sanitiseVariableValue("Name\tSurname")).toBe("Name Surname");
    expect(sanitiseVariableValue("A      B")).toBe("A   B");
  });

  it("trims a value that is over the length limit", () => {
    const result = sanitiseVariableValue("x".repeat(2000));

    expect(result).toHaveLength(MAX_VARIABLE_LENGTH);
    expect(validateVariableValue(result)).toBeNull();
  });

  it("produces something valid for every shape the validator rejects", () => {
    // The two functions must agree: anything sanitise returns has to pass
    // validate, or the journey path is still sending things Meta refuses.
    const hostile = [
      "a\nb",
      "a\r\nb",
      "a\tb",
      "a    b",
      "x".repeat(2000),
      "line\none\ttwo    three" + "y".repeat(2000),
      "\n\n\n",
      "  \t  ",
    ];

    for (const value of hostile) {
      expect(validateVariableValue(sanitiseVariableValue(value))).toBeNull();
    }
  });
});
