import Papa from "papaparse";

import { normalizePhone } from "./phone";

/**
 * CSV import parsing and validation.
 *
 * Guiding rule from the brief: nothing is imported silently and nothing is
 * dropped silently. Every rejected row carries its line number and a reason a
 * non-technical user can act on.
 */

export const IMPORT_LIMITS = {
  /** Guards against a mis-selected file exhausting memory. */
  MAX_FILE_BYTES: 10 * 1024 * 1024, // 10 MB
  MAX_ROWS: 50_000,
} as const;

/*
  Per-field caps.

  The manual add form limits a name to 120 characters and the import path
  limited nothing, while Contact.name is `text`. A cell holding a pasted
  paragraph — or a whole column merged into one field by a bad export — was
  stored in full and then rendered in the contact list, the inbox, and every
  campaign preview.
*/

/** Matches the cap the manual add form already applies. */
const MAX_NAME = 120;
const MAX_ATTRIBUTE_KEY = 64;
const MAX_ATTRIBUTE_VALUE = 512;
/** Unmapped columns kept per row, so a 200-column export cannot bloat a row. */
const MAX_ATTRIBUTES = 30;

/** Header aliases seen in real exports (AiSensy, Google Contacts, Excel). */
const COLUMN_ALIASES: Record<string, string[]> = {
  name: ["name", "full name", "fullname", "contact name", "first name"],
  phone: [
    "phone",
    "phone number",
    "phonenumber",
    "mobile",
    "mobile number",
    "whatsapp",
    "whatsapp number",
    "number",
    "contact",
  ],
  email: ["email", "email address", "e-mail", "mail"],
  tags: ["tags", "tag", "labels", "label", "segment", "groups"],
};

export type ColumnMapping = {
  name?: string;
  phone: string;
  email?: string;
  tags?: string;
};

export interface ParsedContactRow {
  /** 1-based line number in the original file, counting the header. */
  line: number;
  name: string | null;
  phoneE164: string;
  phoneCountry: string | null;
  email: string | null;
  tags: string[];
  /** Unmapped columns, kept for use as template variables. */
  attributes: Record<string, string>;
}

export interface RowError {
  line: number;
  reason: string;
  rawPhone?: string;
}

export interface ParseResult {
  headers: string[];
  suggestedMapping: Partial<ColumnMapping>;
  rows: ParsedContactRow[];
  errors: RowError[];
  /** Duplicates within the uploaded file itself, keyed by E.164. */
  duplicatesInFile: number;
  totalRows: number;
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_-]+/g, " ");
}

/** Best-guess column mapping, which the user confirms or corrects in the UI. */
export function suggestMapping(headers: string[]): Partial<ColumnMapping> {
  const suggestion: Partial<ColumnMapping> = {};

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    // Both sides go through normalizeHeader so that "E-Mail", "e_mail" and
    // "e mail" all reduce to the same key as the alias "e-mail".
    const normalizedAliases = aliases.map(normalizeHeader);
    const match = headers.find((h) =>
      normalizedAliases.includes(normalizeHeader(h)),
    );
    if (match) suggestion[field as keyof ColumnMapping] = match;
  }

  return suggestion;
}

/** Splits a tags cell on comma, semicolon or pipe. */
export function parseTags(raw: string | undefined | null): string[] {
  if (!raw) return [];

  return raw
    .split(/[,;|]/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && t.length <= 50);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parses CSV text into validated rows.
 *
 * Duplicates within the file are resolved last-wins and counted, rather than
 * treated as errors: a spreadsheet listing someone twice is a normal mistake,
 * and failing the whole import over it would be unhelpful.
 */
export function parseContactCsv(
  csvText: string,
  mapping: ColumnMapping,
): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const headers = parsed.meta.fields ?? [];
  const errors: RowError[] = [];
  const byPhone = new Map<string, ParsedContactRow>();
  let duplicatesInFile = 0;

  const mappedColumns = new Set(
    [mapping.name, mapping.phone, mapping.email, mapping.tags].filter(
      (c): c is string => Boolean(c),
    ),
  );

  parsed.data.forEach((record, index) => {
    // +2 because the header occupies line 1 and rows are 0-indexed here.
    const line = index + 2;

    if (byPhone.size >= IMPORT_LIMITS.MAX_ROWS) return;

    /*
      More values on this line than there are columns.

      This is what an unquoted comma inside a cell looks like by the time it
      reaches here. A tags cell reading `pilot,influencers,hyderabad` becomes
      three separate values, so tags takes "pilot", the NEXT column takes
      "influencers", and everything after it shifts by one — the address ends
      up holding a tag, and the real address is spread across columns that do
      not exist.

      Papa reports this as TooManyFields and it was being ignored, which was
      bad in two ways. The extras arrive under `__parsed_extra` as an ARRAY,
      so the attribute loop below called .trim() on it and threw — the import
      died with "could not be completed" and no hint why, identically on every
      retry. And had it not thrown, the row would have imported silently with
      one person's address holding another field's value.

      The row is refused rather than imported shifted: wrong data that looks
      right is worse than a row somebody has to fix.
    */
    const extra = (record as Record<string, unknown>).__parsed_extra;

    if (Array.isArray(extra) && extra.length > 0) {
      errors.push({
        line,
        reason:
          `This line has ${headers.length + extra.length} values but the file has ` +
          `${headers.length} columns, so the values after "${headers[headers.length - 1]}" ` +
          `have shifted. A cell containing a comma must be wrapped in quotes — ` +
          `check the tags and address columns.`,
      });
      return;
    }

    const rawPhone = record[mapping.phone];
    const phoneResult = normalizePhone(rawPhone);

    if (!phoneResult.ok) {
      errors.push({
        line,
        reason: phoneResult.message,
        rawPhone: rawPhone?.trim() || undefined,
      });
      return;
    }

    const rawEmail = mapping.email ? record[mapping.email]?.trim() : undefined;
    const email = rawEmail && EMAIL_PATTERN.test(rawEmail) ? rawEmail : null;

    // An unparseable email is worth flagging but must not cost us the contact —
    // the phone number is what actually matters for WhatsApp.
    if (rawEmail && !email) {
      errors.push({
        line,
        reason: `Email "${rawEmail}" is not valid and was left blank. The contact was still imported.`,
      });
    }

    /*
      Capped, because none of this was.

      The manual add form limits a name to 120 characters; the import path did
      not, and Contact.name is `text` — so a spreadsheet cell containing a
      pasted paragraph, or a whole column accidentally merged into one field,
      was stored in full and then rendered in the contact list, the inbox and
      every campaign preview.

      Truncating beats rejecting here: the row is somebody's real phone number,
      and losing the contact over an oversized notes column would be the worse
      trade.
    */
    const attributes: Record<string, string> = {};
    let attributeCount = 0;

    for (const [key, value] of Object.entries(record)) {
      // Belt and braces after the check above: Papa can hand back a value that
      // is not a string (an array, under __parsed_extra), and `value?.trim()`
      // does not guard against that — optional chaining covers null and
      // undefined, not a missing method. That threw and took the whole import
      // with it.
      if (typeof value !== "string") continue;
      if (mappedColumns.has(key) || !value.trim()) continue;
      if (attributeCount >= MAX_ATTRIBUTES) break;

      attributes[key.slice(0, MAX_ATTRIBUTE_KEY)] = value
        .trim()
        .slice(0, MAX_ATTRIBUTE_VALUE);
      attributeCount += 1;
    }

    const row: ParsedContactRow = {
      line,
      name: mapping.name
        ? record[mapping.name]?.trim().slice(0, MAX_NAME) || null
        : null,
      phoneE164: phoneResult.e164,
      phoneCountry: phoneResult.country ?? null,
      email,
      tags: mapping.tags ? parseTags(record[mapping.tags]) : [],
      attributes,
    };

    if (byPhone.has(row.phoneE164)) duplicatesInFile += 1;
    byPhone.set(row.phoneE164, row);
  });

  return {
    headers,
    suggestedMapping: suggestMapping(headers),
    rows: [...byPhone.values()],
    errors,
    duplicatesInFile,
    totalRows: parsed.data.length,
  };
}

/**
 * Escapes a cell so spreadsheet software cannot execute it as a formula.
 *
 * A contact named `=HYPERLINK("http://evil","click")` would otherwise run when
 * the exported file is opened in Excel.
 */
export function escapeCsvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";

  const str = String(value);
  return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
}

/**
 * One row of CSV, safe to write.
 *
 * Two separate hazards, handled together because handling only one produces a
 * file that is either dangerous or corrupt:
 *
 *  - A leading =, +, - or @ makes Excel treat the value as a formula, so a
 *    contact named =HYPERLINK(...) runs when the file is opened. escapeCsvCell
 *    defuses that.
 *  - A comma, quote or newline inside a value breaks the column structure, so
 *    a contact named "Sharma, Vamshi" silently shifts every later column in
 *    that row. Quoting handles that.
 *
 * This existed correctly but was written out longhand in all three export
 * routes. Three copies of a security control is two too many — the day someone
 * adds a fourth export, or edits one of the three, they diverge silently.
 */
export function toCsvRow(values: Array<string | null | undefined>): string {
  return values
    .map((value) => `"${escapeCsvCell(value).replace(/"/g, '""')}"`)
    .join(",");
}
