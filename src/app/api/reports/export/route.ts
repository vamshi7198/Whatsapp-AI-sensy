import { NextResponse } from "next/server";

import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/session";
import { toCsvRow } from "@/lib/contacts/csv";
import { can } from "@/lib/rbac";
import { getCampaignReport, rangeFromPreset } from "@/lib/reports/service";

const COLUMNS = [
  "campaign",
  "template",
  "category",
  "status",
  "created",
  "recipients",
  "sent",
  "delivered",
  "read",
  "failed",
  "replied",
  "skipped",
  "delivered_rate",
  "read_rate",
  "failed_rate",
  "reply_rate",
] as const;

/** Rate as a plain number so spreadsheets can chart it without parsing "%". */
function rate(value: number, total: number): string {
  if (total <= 0) return "";
  return ((value / total) * 100).toFixed(1);
}

export async function GET(request: Request) {
  const user = await getCurrentUser();

  // 404 rather than 403 — a 403 confirms the endpoint is worth probing.
  if (!can(user, "report:export")) {
    return new NextResponse("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const preset = url.searchParams.get("range") ?? "30d";
  const range = rangeFromPreset(preset);

  const { campaigns } = await getCampaignReport(range);

  const lines = [
    COLUMNS.join(","),
    ...campaigns.map((c) =>
      toCsvRow([
        c.name,
        c.templateName,
        c.category,
        c.status,
        c.createdAt.toISOString(),
        String(c.totalRecipients),
        String(c.sentCount),
        String(c.deliveredCount),
        String(c.readCount),
        String(c.failedCount),
        String(c.repliedCount),
        String(c.skippedCount),
        rate(c.deliveredCount, c.sentCount),
        rate(c.readCount, c.sentCount),
        rate(c.failedCount, c.sentCount),
        rate(c.repliedCount, c.sentCount),
      ]),
    ),
  ];

  await audit(user, "report.export", {
    metadata: { range: preset, campaigns: campaigns.length },
  });

  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="uncanned-report-${preset}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
