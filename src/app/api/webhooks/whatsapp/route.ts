import { after, NextResponse } from "next/server";

import { safeEquals } from "@/lib/crypto";
import { env } from "@/lib/env";
import { moduleLogger } from "@/lib/logger";
import { processWebhookEvents } from "@/lib/webhooks/processor";
import { getProvider } from "@/lib/whatsapp";

const log = moduleLogger("webhook");

/**
 * Meta WhatsApp Cloud API webhook.
 *
 * This endpoint is deliberately exempt from session auth and CSRF — it is
 * machine-to-machine, and its HMAC signature IS its authentication. That is
 * why the signature check below can never be made conditional or skipped.
 *
 * Meta retries aggressively on slow or non-2xx responses, and every retry
 * manufactures a duplicate. So the request path does the minimum — verify,
 * parse, respond 200 — and the database work happens after the response via
 * `after()`.
 */

/**
 * GET — Meta's subscription handshake.
 *
 * Meta calls this once with a challenge when you save the callback URL.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (!env.META_WEBHOOK_VERIFY_TOKEN) {
    log.error("Webhook verification attempted with no verify token configured");
    return new NextResponse("Not configured", { status: 500 });
  }

  // Constant-time compare: a plain === leaks the token through timing given
  // enough attempts.
  if (
    mode === "subscribe" &&
    token &&
    safeEquals(token, env.META_WEBHOOK_VERIFY_TOKEN)
  ) {
    log.info("Webhook verification succeeded");
    return new NextResponse(challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  log.warn({ mode }, "Webhook verification failed");
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * POST — incoming messages and delivery status updates.
 */
export async function POST(request: Request) {
  // The signature is computed over the exact bytes Meta sent. Parsing the JSON
  // and re-serialising it changes those bytes and breaks verification, so the
  // raw body must be read first and parsed only afterwards.
  const rawBody = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get("x-hub-signature-256") ?? "";

  const provider = await getProvider();

  if (!provider) {
    // Returning 200 stops Meta retrying something we can never process, while
    // the log records that events were dropped.
    log.error("Webhook received but WhatsApp is not configured");
    return NextResponse.json({ received: true }, { status: 200 });
  }

  if (!provider.verifyWebhookSignature(rawBody, signature)) {
    log.warn(
      { hasSignature: Boolean(signature), bytes: rawBody.length },
      "Rejected webhook with an invalid signature",
    );
    return new NextResponse("Forbidden", { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    // Malformed JSON from a correctly signed request is not worth retrying.
    log.warn("Rejected webhook with malformed JSON");
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const events = provider.parseWebhook(payload);

  // Respond first, then persist. Slow processing inside the request would make
  // Meta retry and duplicate the very events we are trying to record once.
  after(async () => {
    try {
      const result = await processWebhookEvents(events, true);
      log.info(
        {
          received: events.length,
          processed: result.processed,
          duplicates: result.duplicates,
          failed: result.failed,
        },
        "Webhook events applied",
      );
    } catch (error) {
      log.error(
        { err: error instanceof Error ? error.message : error },
        "Webhook processing threw",
      );
    }
  });

  return NextResponse.json({ received: true }, { status: 200 });
}
