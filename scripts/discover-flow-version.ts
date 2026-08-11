import "dotenv/config";

import { prisma } from "../src/lib/db";
import { getMetaConfig } from "../src/lib/settings";

/**
 * Works out which Flow JSON version this account accepts.
 *
 * Meta does not publish this anywhere machine-readable, its own guide examples
 * disagree with its changelog, and an unsupported version is rejected at
 * upload with no way to guess the right one. So it is established by asking:
 * a throwaway DRAFT flow is created, candidate versions are uploaded to it
 * until one is accepted, and the draft is deleted again.
 *
 * A draft is invisible to customers and deletable, unlike a published flow.
 * The draft is removed even if this fails part-way.
 */

// Newest first: the newest accepted version is the one worth using.
const CANDIDATES = [
  "7.3", "7.2", "7.1", "7.0",
  "6.3", "6.2", "6.1", "6.0",
  "5.1", "5.0",
  "4.0",
  "3.1", "3.0",
];

const PROBE_NAME = "zz-temporary-version-probe";

function minimalFlow(version: string) {
  return {
    version,
    screens: [
      {
        id: "WELCOME",
        title: "Probe",
        terminal: true,
        layout: {
          type: "SingleColumnLayout",
          children: [
            { type: "TextHeading", text: "Probe" },
            {
              type: "Footer",
              label: "Done",
              "on-click-action": { name: "complete", payload: {} },
            },
          ],
        },
      },
    ],
  };
}

async function main() {
  const config = await getMetaConfig();

  if (!config) {
    console.log("WhatsApp is not connected.");
    await prisma.$disconnect();
    return;
  }

  const base = `https://graph.facebook.com/${config.apiVersion}`;
  const auth = { Authorization: `Bearer ${config.accessToken}` };

  console.log("Finding the form version WhatsApp accepts\n");
  console.log("  Creating a temporary draft...");

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
    console.log(`  Could not create one: ${createdJson.error?.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  const flowId = createdJson.id;
  console.log(`  Draft ${flowId} created.\n`);

  const accepted: string[] = [];

  try {
    for (const version of CANDIDATES) {
      const form = new FormData();
      form.set("name", "flow.json");
      form.set("asset_type", "FLOW_JSON");
      form.set(
        "file",
        new Blob([JSON.stringify(minimalFlow(version))], {
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
        success?: boolean;
        validation_errors?: Array<{ message?: string; error?: string }>;
        error?: { message?: string };
      };

      const problem =
        body.validation_errors?.[0]?.message ??
        body.validation_errors?.[0]?.error ??
        body.error?.message;

      if (response.ok && !body.validation_errors?.length) {
        accepted.push(version);
        console.log(`  ${version}  accepted`);
      } else {
        console.log(`  ${version}  rejected — ${problem ?? "no reason given"}`);
      }
    }
  } finally {
    // Always clean up. A stray draft on the account is clutter at best and
    // confusing at worst.
    console.log("\n  Removing the temporary draft...");
    const deleted = await fetch(`${base}/${flowId}`, {
      method: "DELETE",
      headers: auth,
    });
    console.log(
      deleted.ok ? "  Removed." : "  Could not remove it — delete it manually.",
    );
  }

  console.log("");

  if (accepted.length === 0) {
    console.log("Nothing was accepted. None of the versions tried are valid,");
    console.log("or the form itself was rejected for another reason.");
  } else {
    console.log(`Use version "${accepted[0]}".`);
    console.log(`Also accepted: ${accepted.slice(1).join(", ") || "none"}`);
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
