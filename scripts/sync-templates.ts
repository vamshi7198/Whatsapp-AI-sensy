import "dotenv/config";

import { prisma } from "../src/lib/db";
import { syncTemplates } from "../src/lib/templates/service";

/**
 * Pulls templates from Meta into the local cache.
 *
 * The same function the Sync button calls; available here so it can also be
 * run from a scheduled task without a browser.
 */
async function main() {
  const result = await syncTemplates();

  if (!result.ok) {
    console.error(`Sync failed: ${result.error}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(
    `Synced: ${result.created} new, ${result.updated} updated, ${result.disabled} no longer available (${result.total} total)`,
  );

  const templates = await prisma.template.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      name: true,
      language: true,
      category: true,
      status: true,
      variableCount: true,
      components: true,
    },
  });

  console.log("");
  for (const t of templates) {
    console.log(
      `  ${t.status.padEnd(9)} ${t.category.padEnd(15)} ${t.name} (${t.language}) - ${t.variableCount} variable(s)`,
    );

    const body = (t.components as Array<{ type: string; text?: string }>)?.find(
      (c) => c.type === "BODY",
    );
    if (body?.text) {
      console.log(`             "${body.text.replace(/\n/g, " ").slice(0, 100)}"`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
