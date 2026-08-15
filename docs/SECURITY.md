# Security

What is protected, how, and what is deliberately not.

---

## The Meta access token

The single most valuable secret here. Anyone holding it can message every
customer from Uncanned's own WhatsApp number.

- **Encrypted at rest** with a key from `.env`, never stored in plain text.
- **Never sent to the browser.** Not the value, not a prefix, not its length.
  Every Meta API call happens server-side.
- **Never shown again after saving.** The settings page shows whether a token
  is present, and nothing more.
- **Never written to a log.** Log output is checked for this specifically.

`/api/health` reports `whatsapp: configured` or `not configured` and that is
the whole of what it will say.

---

## The webhook

`/api/webhooks/whatsapp` is public, because Meta has to reach it. It is
protected by:

- **HMAC-SHA256 signature verification** over the exact bytes Meta sent, using
  the app secret, compared with `timingSafeEqual` so the comparison cannot be
  timed. An unsigned, forged or tampered request gets a 403.
- **A separate verify token** for the one-time subscription handshake.
- **A 1 MB body cap**, checked before the body is buffered. The endpoint is
  public and one Node process serves the inbox, campaign sending and this, so
  an unbounded read would stop all three.

Verified behaviour: correctly signed → 200; unsigned, forged, or a modified
body → 403 each; wrong verify token → 403.

---

## Sessions and passwords

- Passwords hashed with **Argon2id**.
- **Database-backed sessions**, not JWTs — which is the whole reason
  deactivating a user or changing their role takes effect immediately rather
  than at their next login.
- **Account lockout** after repeated failures.

**A known, accepted trade-off:** the lockout message reveals that an account
exists. Hiding it would mean running Argon2 (about 19 MB of memory per attempt)
for every login on a locked account, turning an information leak into a way to
exhaust the machine's memory. The short-circuit is the DoS protection, and on a
single-tenant internal tool the leak is worth less than the machine staying up.

---

## Permissions

Three roles — **ADMIN**, **MANAGER**, **AGENT** — checked on the server for
every action. Navigation is filtered by role as well, but that is for
usability: each route guards itself independently and never relies on the menu.

Pages an unauthenticated visitor requests redirect to login. Export endpoints
return **404**, not 403, because a 403 confirms the endpoint exists and is
worth probing.

At least one active administrator is guaranteed. That check counts and writes
inside one Serializable transaction, so two people demoting the last two
administrators at the same moment cannot both succeed.

---

## Outbound requests

A journey can call an external webhook, which is a request the server makes to
a URL an operator typed. That is checked at request time, not only when saved:

- **https only**
- Blocked: `localhost`, `127.x`, `10.x`, `172.16–31.x`, `192.168.x`,
  `169.254.x`, `::1`, `fc/fd/fe80`, `.internal`, `.local`, cloud metadata
  endpoints, and URLs carrying embedded credentials
- Redirects are **not followed** (`redirect: "manual"`), so a public URL cannot
  bounce the request to an internal one
- Interpolated values are percent-encoded

---

## Uploads

- 5 MB cap, checked from `Content-Length` **before** the body is parsed, and
  again on the real size afterwards
- Type allowlist: JPEG, PNG, MP4, PDF
- Leading bytes checked against the declared type, so a renamed file is
  refused. This is not a security control — the extension comes from our own
  allowlist — but Meta rejects a mislabelled file at send time, once per
  recipient, and finding out then is much worse

---

## Data handling

- **Phone numbers are masked in logs.**
- **Opt-outs are recorded, not just flagged.** Every one writes an audit row
  with the time, the cause, and the message that triggered it. A boolean proves
  nothing if a request is ever disputed.
- **Deleting a contact is a soft delete**, and neither a CSV re-import nor
  adding the number again will undo it. Under India's DPDP an erasure request
  quietly reversing itself is a real problem, and re-adding somebody also used
  to stamp a fresh marketing-consent record dated today.
- **CSV exports neutralise formula injection** — a cell beginning `=`, `+`, `-`
  or `@` is prefixed so a spreadsheet treats it as text.

---

## What this deliberately does not do

- **No unofficial WhatsApp access.** Official Meta WhatsApp Business Platform
  APIs only. No scraping, no WhatsApp Web automation, no QR-code sessions.
- **No bypassing template approval.** Marketing messages go through Meta's
  approval, and template status is checked three times before a send.
- **No secrets in the repository.** Verified against the full git history, and
  against the built browser bundle using the actual values from `.env`.

---

## If a token leaks

1. Revoke it in Meta Business Manager → System Users → the user → revoke.
2. Generate a new System User token.
3. Save it in Settings → WhatsApp.
4. Check Settings → Activity log for sends you do not recognise.

The token is a System User token and does not expire, which is convenient and
means a leak stays useful indefinitely until revoked.
