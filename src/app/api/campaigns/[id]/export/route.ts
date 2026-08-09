import { NextResponse } from "next/server";

import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/session";
import { SKIP_REASON_LABELS } from "@/lib/campaigns/audience";
import { escapeCsvCell } from "@/lib/contacts/csv";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";

const COLUMNS = [
  "name",
  "phone",
  "status",
  "sent_at",
  "delivered_at",
  "read_at",
  "replied_at",
  "reason",
] as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();

  // 404 rather than 403 — a 403 confirms the campaign exists.
  if (!can(user, "report:export")) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { id } = await params;

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: { name: true },
  });

  if (!campaign) return new NextResponse("Not found", { status: 404 });

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId: id },
    orderBy: { createdAt: "asc" },
    select: {
      name: true,
      phoneE164: true,
      status: true,
      skipReason: true,
      repliedAt: true,
      message: {
        select: {
          sentAt: true,
          deliveredAt: true,
          readAt: true,
          errorUserMessage: true,
        },
      },
    },
  });

  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");

  const lines = [
    COLUMNS.join(","),
    ...recipients.map((r) =>
      [
        r.name ?? "",
        r.phoneE164,
        r.status,
        iso(r.message?.sentAt),
        iso(r.message?.deliveredAt),
        iso(r.message?.readAt),
        iso(r.repliedAt),
        // Plain English in the export too — this file gets forwarded to people
        // who will never see the app.
        r.message?.errorUserMessage ??
          (r.skipReason
            ? (SKIP_REASON_LABELS[
                r.skipReason as keyof typeof SKIP_REASON_LABELS
              ] ?? r.skipReason)
            : ""),
      ]
        .map((value) => `"${escapeCsvCell(value).replace(/"/g, '""')}"`)
        .join(","),
    ),
  ];

  await audit(user, "campaign.export", {
    entityType: "Campaign",
    entityId: id,
    metadata: { count: recipients.length },
  });

  const safeName = campaign.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName || "campaign"}-report.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
