import { NextResponse } from "next/server";

import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/session";
import { toCsvRow } from "@/lib/contacts/csv";
import { buildContactWhere, readCustomFields } from "@/lib/contacts/service";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";

/** Hard cap so a single request cannot stream the entire database. */
const MAX_EXPORT_ROWS = 50_000;

const COLUMNS = [
  "name",
  "phone",
  "email",
  "tags",
  "source",
  "opt_in_status",
  "marketing_opt_out",
  "whatsapp_status",
  "last_contacted",
  "date_added",
] as const;

export async function GET(request: Request) {
  const user = await getCurrentUser();

  // 404 rather than 403: a 403 confirms the endpoint exists and is worth
  // probing.
  if (!can(user, "contact:export")) {
    return new NextResponse("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const where = buildContactWhere({
    search: url.searchParams.get("search") ?? undefined,
    optInStatus:
      (url.searchParams.get("optIn") as
        | "UNKNOWN"
        | "OPTED_IN"
        | "OPTED_OUT"
        | null) ?? undefined,
    source: url.searchParams.get("source") ?? undefined,
    tagIds: url.searchParams.getAll("tag").filter(Boolean),
  });

  const contacts = await prisma.contact.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: MAX_EXPORT_ROWS,
    select: {
      name: true,
      phoneE164: true,
      email: true,
      source: true,
      optInStatus: true,
      marketingOptOut: true,
      whatsappStatus: true,
      lastContactedAt: true,
      createdAt: true,
      attributes: true,
      tags: { select: { tag: { select: { name: true } } } },
    },
  });

  /*
    Custom fields become columns of their own.

    Without this an export silently dropped them: import a file carrying an
    address and an AWB number, export it back, and both are gone — so the
    export could not be used to round-trip or hand over the data, which is
    most of what an export is for.

    The column set is collected from the rows themselves rather than declared,
    so a field added to next month's import appears here on its own. Union
    across every row, since contacts imported from different files will not
    all carry the same fields.
  */
  const customColumns = [
    ...new Set(
      contacts.flatMap((c) => readCustomFields(c.attributes).map(([key]) => key)),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const iso = (d: Date | null) => (d ? d.toISOString() : "");

  const lines = [
    [...COLUMNS, ...customColumns].join(","),
    ...contacts.map((c) => {
      const fields = new Map(readCustomFields(c.attributes));

      return toCsvRow([
        c.name ?? "",
        c.phoneE164,
        c.email ?? "",
        c.tags.map((t) => t.tag.name).join(";"),
        c.source ?? "",
        c.optInStatus,
        c.marketingOptOut ? "yes" : "no",
        c.whatsappStatus,
        iso(c.lastContactedAt),
        iso(c.createdAt),
        // Blank where a contact does not have this one, so every row still
        // lines up with the header.
        ...customColumns.map((key) => fields.get(key) ?? ""),
      ]);
    }),
  ];

  await audit(user, "contact.export", {
    metadata: { count: contacts.length },
  });

  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="uncanned-contacts-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
