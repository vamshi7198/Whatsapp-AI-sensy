import "dotenv/config";

import { prisma } from "../src/lib/db";
import { getMetaConfig } from "../src/lib/settings";
import { formatCost } from "../src/lib/utils";

/**
 * Reads actual conversation volume and cost from Meta.
 *
 * This is what Meta will bill, as opposed to the estimate shown before
 * sending. Estimates assume every message is delivered; Meta charges only for
 * delivered messages, so the real figure is usually a little lower.
 *
 * Usage: npx tsx scripts/meta-spend.ts [days]
 */

interface AnalyticsPoint {
  start?: number;
  end?: number;
  conversation?: number;
  cost?: number;
  conversation_type?: string;
  conversation_category?: string;
}

interface AnalyticsResponse {
  conversation_analytics?: {
    data?: Array<{ data_points?: AnalyticsPoint[] }>;
  };
  error?: { message?: string; code?: number };
}

async function main() {
  const days = Number(process.argv[2] ?? 30);
  const config = await getMetaConfig();

  if (!config) {
    console.log("WhatsApp is not connected.");
    await prisma.$disconnect();
    return;
  }

  const end = Math.floor(Date.now() / 1000);
  const start = end - days * 24 * 60 * 60;

  // Meta expects the analytics parameters inline on the field, not as query
  // parameters, which is why this reads unusually.
  const field =
    `conversation_analytics.start(${start}).end(${end})` +
    `.granularity(DAILY)` +
    `.phone_numbers([])` +
    `.metric_types(["COST","CONVERSATION"])` +
    `.dimensions(["CONVERSATION_CATEGORY"])`;

  const url =
    `https://graph.facebook.com/${config.apiVersion}/${config.wabaId}` +
    `?fields=${encodeURIComponent(field)}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });

  const body = (await response.json()) as AnalyticsResponse;

  if (body.error) {
    console.log(`Meta returned an error: ${body.error.message}`);
    console.log("");
    console.log(
      "Conversation analytics needs the whatsapp_business_management",
    );
    console.log("permission, which this token has - so this usually means");
    console.log("there is no billable activity yet.");
    await prisma.$disconnect();
    return;
  }

  const points =
    body.conversation_analytics?.data?.flatMap((d) => d.data_points ?? []) ?? [];

  if (points.length === 0) {
    console.log(`No billable conversations in the last ${days} days.`);
    console.log("Nothing has been sent yet, so Meta has nothing to charge.");
    await prisma.$disconnect();
    return;
  }

  const byCategory = new Map<string, { conversations: number; cost: number }>();
  let totalConversations = 0;
  let totalCost = 0;

  for (const p of points) {
    const category = p.conversation_category ?? "UNKNOWN";
    const current = byCategory.get(category) ?? { conversations: 0, cost: 0 };

    current.conversations += p.conversation ?? 0;
    current.cost += p.cost ?? 0;
    byCategory.set(category, current);

    totalConversations += p.conversation ?? 0;
    totalCost += p.cost ?? 0;
  }

  console.log(`Meta's own figures for the last ${days} days\n`);

  for (const [category, stats] of byCategory) {
    console.log(
      `  ${category.padEnd(16)} ${String(stats.conversations).padStart(6)} conversations   ${formatCost(stats.cost, "USD")}`,
    );
  }

  console.log("");
  console.log(
    `  ${"TOTAL".padEnd(16)} ${String(totalConversations).padStart(6)} conversations   ${formatCost(totalCost, "USD")}`,
  );

  // Compared against what this app recorded, so a gap between the two is
  // visible rather than assumed away.
  const oursSent = await prisma.message.count({
    where: {
      direction: "OUTBOUND",
      status: { not: "FAILED" },
      createdAt: { gte: new Date(start * 1000) },
    },
  });

  console.log("");
  console.log(`  This app recorded ${oursSent} outgoing message(s) in the same period.`);
  console.log(
    "  Meta counts conversations, not messages, so the numbers differ by design:",
  );
  console.log(
    "  several messages to one person within a window are one conversation.",
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
