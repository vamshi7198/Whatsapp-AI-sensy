import { getSetting, SETTING_KEYS } from "../settings";
import { moduleLogger } from "../logger";

const log = moduleLogger("webhook-forward");

/**
 * Forwards a copy of each Meta webhook to a second destination.
 *
 * Meta allows only one callback URL per app, so adopting this platform would
 * otherwise silently kill any existing integration — a Google Apps Script, a
 * sheet logger, an internal tool. Forwarding lets both run.
 *
 * Three properties this must have:
 *
 *  1. It forwards the EXACT original bytes and the original signature header,
 *     so the downstream system can verify the payload against Meta's App
 *     Secret exactly as if Meta had called it directly.
 *  2. It never blocks or fails the response to Meta. A dead forwarding target
 *     must not cause Meta to retry, which would duplicate our own processing.
 *  3. It is capped by a timeout, so a hanging target cannot pile up requests.
 */

const FORWARD_TIMEOUT_MS = 10_000;

/**
 * Rejects destinations that point back inside our own network.
 *
 * The URL is admin-configured rather than user-supplied, so this is defence in
 * depth rather than the primary control — but an admin pasting the wrong thing
 * should not turn the webhook into a probe of the local network.
 */
export function isSafeForwardUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();

  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return false;
  }

  // Private IPv4 ranges, when a bare address is given rather than a name.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
  }

  return true;
}

export interface ForwardResult {
  attempted: boolean;
  ok?: boolean;
  status?: number;
  error?: string;
}

/**
 * Sends the payload on, if forwarding is configured and enabled.
 *
 * Deliberately swallows every error: the caller has already responded 200 to
 * Meta, and a forwarding failure is a problem for the downstream system, not
 * a reason to make Meta resend.
 */
export async function forwardWebhook(
  rawBody: Buffer,
  signatureHeader: string,
): Promise<ForwardResult> {
  const [url, enabled] = await Promise.all([
    getSetting(SETTING_KEYS.WEBHOOK_FORWARD_URL),
    getSetting(SETTING_KEYS.WEBHOOK_FORWARD_ENABLED),
  ]);

  if (!url || enabled !== "true") return { attempted: false };

  if (!isSafeForwardUrl(url)) {
    log.error({ url }, "Refusing to forward to an unsafe destination");
    return { attempted: false, error: "unsafe destination" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Passed through unchanged so the downstream can verify it itself.
        "X-Hub-Signature-256": signatureHeader,
        "X-Forwarded-By": "uncanned-whatsapp",
      },
      body: new Uint8Array(rawBody),
      signal: controller.signal,
      // Google Apps Script answers with a 302 to a script.googleusercontent.com
      // URL; without following it every forward looks like a failure.
      redirect: "follow",
    });

    if (!response.ok) {
      log.warn(
        { status: response.status, url },
        "Forwarding target returned an error",
      );
    } else {
      log.debug({ status: response.status }, "Webhook forwarded");
    }

    return { attempted: true, ok: response.ok, status: response.status };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "timed out"
        : error instanceof Error
          ? error.message
          : String(error);

    // Logged, never thrown: Meta has already had its 200.
    log.warn({ url, err: message }, "Could not forward webhook");
    return { attempted: true, ok: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}
