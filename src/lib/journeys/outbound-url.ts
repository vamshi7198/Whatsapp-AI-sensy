/**
 * Checking a URL before the server fetches it.
 *
 * The webhook step calls whatever address a journey names. That address is
 * authored by an operator, but the server making the request sits on the same
 * machine as PostgreSQL and the application itself — so an address like
 * http://localhost:5432 or http://127.0.0.1:3000 reaches things no customer
 * should be able to touch, from inside the trust boundary. That is server-side
 * request forgery, and being fetched "only" by a trusted operator's
 * configuration does not make it safe: the operator is not attacking anyone,
 * they are one typo away from pointing a step at their own database.
 *
 * Values interpolated into the URL make it sharper still, because those come
 * from what a customer typed.
 */

/** Hosts that are never a legitimate destination for an outbound webhook. */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "::" || host === "::1") return true;

  // Cloud metadata endpoints. Not relevant on this laptop today, but this
  // moves to a server eventually and the day it does, this line matters.
  if (host === "metadata.google.internal" || host === "169.254.169.254") {
    return true;
  }

  // .internal and .local resolve to things inside the network.
  if (host.endsWith(".internal") || host.endsWith(".local")) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);

  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];

    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local
    if (a === 0) return true;
    if (a >= 224) return true; // multicast and reserved
  }

  // IPv6 private and loopback ranges, in the forms that appear in URLs.
  if (host.startsWith("fc") || host.startsWith("fd")) return true; // unique local
  if (host.startsWith("fe80")) return true; // link-local

  return false;
}

export interface UrlCheck {
  ok: boolean;
  url?: URL;
  reason?: string;
}

/**
 * Whether the server may fetch this address.
 *
 * Checked at the moment of the request, not only when the journey was
 * published — a URL built from a customer's answer is not the URL that was
 * validated.
 */
export function checkOutboundUrl(raw: string): UrlCheck {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "That is not a valid web address." };
  }

  if (url.protocol !== "https:") {
    return {
      ok: false,
      reason: "The address must start with https:// so the request is encrypted.",
    };
  }

  if (isBlockedHost(url.hostname)) {
    return {
      ok: false,
      reason:
        "That address points back at this machine or a private network, which is not allowed.",
    };
  }

  // Credentials in a URL are almost always a mistake, and they would be sent
  // to whatever the host resolves to.
  if (url.username || url.password) {
    return {
      ok: false,
      reason: "The address must not contain a username or password.",
    };
  }

  return { ok: true, url };
}

/**
 * Fills variables into a URL without letting them change where it points.
 *
 * Substituting raw text into a URL lets an answer containing "?", "#", "/" or
 * "@" alter the path, the query, or in some parsers the host itself. Each
 * value is percent-encoded so it can only ever be data.
 */
export function renderUrl(
  template: string,
  values: Record<string, unknown>,
): string {
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_match, key: string) => {
      const value = values[key];
      if (value === null || value === undefined) return "";

      return encodeURIComponent(
        Array.isArray(value) ? value.join(",") : String(value),
      );
    },
  );
}
