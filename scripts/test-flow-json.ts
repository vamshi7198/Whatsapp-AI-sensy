import "dotenv/config";

import {
  buildFlowJson,
  FLOW_TEMPLATES,
  validateFlow,
} from "../src/lib/flows/builder";
import { prisma } from "../src/lib/db";
import { getMetaConfig } from "../src/lib/settings";

/**
 * Checks that every built-in form is JSON WhatsApp actually accepts.
 *
 * Meta is the only authority on whether Flow JSON is valid — its rules are not
 * published in full and the examples in its guide are years out of date. So
 * each form is uploaded to a throwaway DRAFT and the verdict read back.
 *
 * The draft is deleted afterwards, including on failure. Drafts are invisible
 * to customers; nothing here can reach one.
 */

const PROBE_NAME = "zz-temporary-json-check";
let failures = 0;

async function main() {
  const config = await getMetaConfig();

  if (!config) {
    console.log("WhatsApp is not connected.");
    await prisma.$disconnect();
    return;
  }

  const base = `https://graph.facebook.com/${config.apiVersion}`;
  const auth = { Authorization: `Bearer ${config.accessToken}` };

  console.log("Checking the built-in forms against WhatsApp\n");

  /* ------------------------------------------------------------------ */
  /* Our own validation first                                            */
  /* ------------------------------------------------------------------ */

  for (const [key, template] of Object.entries(FLOW_TEMPLATES)) {
    const result = validateFlow(template.definition);

    if (!result.ok) {
      failures += 1;
      console.log(`  [FAIL] ${key} — our own checks: ${result.errors.join("; ")}`);
    } else {
      console.log(`  [PASS] ${key} — our own checks`);
    }
  }

  console.log("");

  /* ------------------------------------------------------------------ */
  /* Then Meta's                                                         */
  /* ------------------------------------------------------------------ */

  const created = await fetch(`${base}/${config.wabaId}/flows`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ name: PROBE_NAME, categories: ["OTHER"] }),
  });

  const createdJson = (await created.json()) as {
    id?: string;
    error?: { message?: string };
  };

  if (!createdJson.id) {
    console.log(`Could not create a draft: ${createdJson.error?.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  const flowId = createdJson.id;

  try {
    for (const [key, template] of Object.entries(FLOW_TEMPLATES)) {
      const form = new FormData();
      form.set("name", "flow.json");
      form.set("asset_type", "FLOW_JSON");
      form.set(
        "file",
        new Blob([JSON.stringify(buildFlowJson(template.definition))], {
          type: "application/json",
        }),
        "flow.json",
      );

      const response = await fetch(`${base}/${flowId}/assets`, {
        method: "POST",
        headers: auth,
        body: form,
      });

      const body = (await response.json().catch(() => ({}))) as {
        validation_errors?: Array<{
          message?: string;
          error?: string;
          line_start?: number;
        }>;
        error?: { message?: string };
      };

      if (response.ok && !body.validation_errors?.length) {
        console.log(`  [PASS] ${key} — WhatsApp accepted it`);
      } else {
        failures += 1;
        const problem =
          body.validation_errors
            ?.map(
              (e) =>
                `${e.message ?? e.error}${e.line_start !== undefined ? ` (line ${e.line_start})` : ""}`,
            )
            .join("; ") ?? body.error?.message;

        console.log(`  [FAIL] ${key} — WhatsApp rejected it: ${problem}`);
      }
    }
  } finally {
    const deleted = await fetch(`${base}/${flowId}`, {
      method: "DELETE",
      headers: auth,
    });

    console.log(
      deleted.ok
        ? "\n  Temporary draft removed."
        : `\n  Could not remove draft ${flowId} — delete it manually.`,
    );
  }

  console.log("");

  if (failures > 0) {
    console.log(`${failures} check(s) failed.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("All forms are valid.");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
