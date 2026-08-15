import { createHmac, timingSafeEqual } from "node:crypto";

import { after, NextResponse } from "next/server";

import { safeEquals } from "@/lib/crypto";
import { env } from "@/lib/env";
import { moduleLogger } from "@/lib/logger";
import { forwardWebhook } from "@/lib/webhooks/forwarder";
import {
  applyStoredEvents,
  storeWebhookEvents,
} from "@/lib/webhooks/processor";
import { parseMetaWebhook } from "@/lib/whatsapp/providers/meta/mappers";

const log = moduleLogger("webhook");

/**
 * The most this endpoint will read from a request.
 *
 * The largest payload this system has ever stored is about 2 KB, so a megabyte
 * is enormous headroom for anything Meta legitimately sends while still being
 * a bound.
 */
const MAX_WEBHOOK_BYTES = 1024 * 1024;

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
 *
 * Note what this route does NOT depend on: the Meta access token. Receiving
 * needs only the App Secret, which lives in the environment. Requiring the
 * token here would leave the inbox dead while a token was pending approval,
 * for no security benefit.
 */

/** Verifies X-Hub-Signature-256 over the raw request bytes. */
function verifySignature(rawBody: Buffer, signatureHeader: string): boolean {
  if (!env.META_APP_SECRET) {
    log.error("Webhook received but META_APP_SECRET is not configured");
    return false;
  }

  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", env.META_APP_SECRET)
    .update(rawBody)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader.slice("sha256=".length), "utf8");

  // timingSafeEqual throws on length mismatch; the length is not the secret.
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

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
  // Refused on size before a byte is buffered.
  //
  // This URL is public by design — Meta has to reach it — and the check below
  // cannot run until the whole body is in memory, so an unbounded read happens
  // BEFORE anything is verified. One Node process serves the inbox, campaign
  // sending and this endpoint, so filling its heap stops all three.
  //
  // Next.js's bodySizeLimit applies to Server Actions, not route handlers, and
  // there is no middleware, so nothing else was stopping it. 1 MB is enormous
  // headroom: the largest payload this system has ever stored is about 2 KB.
  const declared = Number(request.headers.get("content-length") ?? 0);

  if (declared > MAX_WEBHOOK_BYTES) {
    log.warn({ bytes: declared }, "Rejected an oversized webhook body");
    return new NextResponse("Payload too large", { status: 413 });
  }

  // The signature is computed over the exact bytes Meta sent. Parsing the JSON
  // and re-serialising it changes those bytes and breaks verification, so the
  // raw body must be read first and parsed only afterwards.
  const rawBody = Buffer.from(await request.arrayBuffer());

  // Content-Length can be absent or untrue, and a chunked request carries no
  // length at all — so the real size is checked too, once it is known.
  if (rawBody.length > MAX_WEBHOOK_BYTES) {
    log.warn({ bytes: rawBody.length }, "Rejected an oversized webhook body");
    return new NextResponse("Payload too large", { status: 413 });
  }
  const signature = request.headers.get("x-hub-signature-256") ?? "";

  if (!verifySignature(rawBody, signature)) {
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

  const events = parseMetaWebhook(payload);

  // Store the raw payload BEFORE acknowledging. Meta discards an event once
  // it receives a 200 and offers no replay API, so acknowledging first would
  // mean a crash in that instant loses a customer message permanently.
  //
  // This is only an insert — no lookups, no counters — so it stays well
  // inside the time Meta allows before it treats the response as failed.
  let stored: typeof events = [];
  try {
    // The whole body is stored, not each event's inner object, so recovery
    // can re-parse it later. The parser needs the full envelope.
    const result = await storeWebhookEvents(events, true, payload);
    stored = result.stored;

    if (result.duplicates > 0) {
      log.debug(
        { duplicates: result.duplicates },
        "Ignored events Meta had already delivered",
      );
    }
  } catch (error) {
    // Storing failed, so returning 200 would tell Meta to forget an event we
    // do not have. A 500 keeps it in Meta's retry queue for up to 7 days.
    log.error(
      { err: error instanceof Error ? error.message : error },
      "Could not store webhook — asking Meta to retry",
    );
    return new NextResponse("Storage failed", { status: 500 });
  }

  // Everything below is safe to lose: the payload is already durable, and
  // recoverUnprocessedEvents() will pick up anything left unapplied.
  after(async () => {
    try {
      const result = await applyStoredEvents(stored);
      log.info(
        {
          received: events.length,
          processed: result.processed,
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

    // Pass a copy to any pre-existing integration. Runs after our own
    // processing and independently of it: a broken forwarding target must
    // never cost us an inbound message.
    await forwardWebhook(rawBody, signature).catch(() => undefined);
  });

  return NextResponse.json({ received: true }, { status: 200 });
}
