import { NextResponse } from "next/server";

import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/session";
import { escapeCsvCell } from "@/lib/contacts/csv";
import { buildContactWhere } from "@/lib/contacts/service";
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
      tags: { select: { tag: { select: { name: true } } } },
    },
  });

  const iso = (d: Date | null) => (d ? d.toISOString() : "");

  const lines = [
    COLUMNS.join(","),
    ...contacts.map((c) =>
      [
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
      ]
        // Every cell is escaped against formula injection, then quoted so
        // commas and quotes inside values cannot break the column structure.
        .map((value) => `"${escapeCsvCell(value).replace(/"/g, '""')}"`)
        .join(","),
    ),
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
