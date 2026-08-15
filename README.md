# Uncanned WhatsApp

An internal WhatsApp management platform for **Uncanned** — a simple interface
over the official **Meta WhatsApp Cloud API**, built to replace AiSensy.

> Meta WhatsApp Cloud API remains the messaging infrastructure. This is a
> user-friendly wrapper around it — not a replacement for WhatsApp or Meta, and
> not an unofficial WhatsApp client.

---

## What it does

| Area | Capability |
|---|---|
| **Contacts** | CRUD, search, filters, tags, bulk actions, CSV import with per-row error reporting, CSV export |
| **Inbox** | WhatsApp-style two-pane chat, free-form replies inside the 24-hour service window, unread counts, template fallback when the window closes |
| **Campaigns** | Six-step wizard, audience by tag / manual pick / CSV, variable mapping, five-recipient preview, cost estimate, confirmation gate |
| **Templates** | Sync from Meta, create and submit for approval, buttons, live preview against a real contact, grouped by approval status |
| **Reports** | Delivery, read, failure and reply rates; why messages failed; why contacts were skipped; CSV export |
| **Settings** | WhatsApp connection, team members with roles, activity log |
| **Compliance** | Explicit opt-in, automatic STOP/UNSUBSCRIBE handling, marketing gate, audit trail |

---

## Architecture

```
Browser ──► Next.js (app + API routes) ──► PostgreSQL
                     │
                     ├──► Meta WhatsApp Cloud API   (outbound, server-side only)
                     └──◄ Meta webhook              (inbound + delivery status)
```

**Stack:** Next.js 16, TypeScript, Tailwind 4, PostgreSQL 16, Prisma 7,
argon2id, Pino, Vitest.

**Provider abstraction.** All Meta-specific code lives behind a
`WhatsAppProvider` interface in `src/lib/whatsapp/`. Campaigns, the inbox and
automations speak only domain types, so replacing Meta later means writing one
class rather than rewriting the application.

---

## Design decisions worth knowing

**Consent is never inferred.** Messaging the business does not opt someone in.
Marketing campaigns require a stored opt-in with a timestamp and a source;
utility messages such as order updates are exempt, because that is Meta's rule.

**Four layers prevent a double send.** A unique idempotency key per campaign, a
unique constraint per contact per campaign, variables frozen at creation, and a
timed-out send recorded as sent-but-unconfirmed rather than retried — a
duplicate message to a real customer is worse than an uncertain record.

**Webhook processing is idempotent and order-independent.** Meta retries, and
can deliver `read` before `delivered`. Events are deduplicated by hash, and
status transitions only ever advance.

**Template approval is checked three times** — at campaign creation, at batch
start, and immediately before each API call. Meta can pause a template
mid-campaign.

**Errors are translated, not exposed.** Meta's error codes map to plain English
with a suggested action. Codes appear only in the admin activity log.

---

## Running it

Requires Node 24 and PostgreSQL 16.

```bash
git clone <this repo>
cd uncanned-whatsapp
npm ci

cp .env.example .env
powershell -File deploy/generate-secrets.ps1     # fills in the secrets
powershell -File scripts/bootstrap-db.ps1        # creates role + database

npm run db:deploy
npm run db:seed
npm run build
npm start
```

Then open http://localhost:3000 and connect WhatsApp under **Settings**.

### Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run verify` | Lint, typecheck and tests |
| `npm run db:migrate` | Create and apply a migration |
| `npx tsx scripts/account-health.ts` | Phone number status, quality, limits |
| `npx tsx scripts/check-token.ts` | Whether the access token expires |
| `npx tsx scripts/meta-spend.ts` | Actual conversation cost from Meta |
| `npx tsx scripts/test-roles.ts` | Request every page as each role |

### Deployment

See [`deploy/README.md`](deploy/README.md) and
[`deploy/THIS-MACHINE.md`](deploy/THIS-MACHINE.md). The app is self-hosted and
exposed via Cloudflare Tunnel; `deploy/update.ps1` builds and restarts in one
step, because replacing the build under a running Next.js server breaks it.

---

## Configuration

Secrets live in `.env`, which is **not** committed. See `.env.example`.

The WhatsApp Business Account ID, Phone Number ID and access token are **not**
environment variables — an administrator sets them in Settings, and the token
is AES-256-GCM encrypted at rest and never returned to the browser. Rotating
credentials therefore needs no redeploy.

> The PostgreSQL password in `.env.example`, `docker-compose.yml` and
> `scripts/bootstrap-db.ps1` is a local development default. Change it for any
> real deployment.

---

## Tests

```bash
npm run verify     # 249 unit tests, plus lint and typecheck
```

Integration scripts in `scripts/` run against a real database and clean up
after themselves — covering webhook idempotency, out-of-order delivery
statuses, the compliance gate, duplicate-send protection, journey re-entry and
concurrency, and secret encryption.

[docs/TESTING.md](docs/TESTING.md) explains which tests exist because the
obvious implementation was wrong, and what is not covered.

---

## Running it in production

| | |
|---|---|
| [deploy/README.md](deploy/README.md) | Setting the machine up from scratch |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | The scheduled tasks, the health endpoint, the weekly routine |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Symptom → cause → fix |
| [docs/BACKUP_AND_RECOVERY.md](docs/BACKUP_AND_RECOVERY.md) | Where backups go, how to check one, how to restore |
| [docs/SECURITY.md](docs/SECURITY.md) | What is protected and what is deliberately not |

---

## Not built

Deliberately out of scope: multi-tenancy, catalog and payment messages.

Built since this list was first written, and no longer excluded: WhatsApp
Flows, automations, scheduled campaigns, and the visual journey builder.
