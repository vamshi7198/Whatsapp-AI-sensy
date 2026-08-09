# Working on this codebase

Read this before your first change. It is short, and most of it is about the
few things that can cause real harm.

---

## What this system actually does

It sends WhatsApp messages to real customers, and each one costs money. A
mistake here is not a broken page — it is hundreds of people receiving the
wrong message, and WhatsApp cannot recall a delivered message.

Three consequences worth holding on to:

1. **Sending is irreversible.** There is no undo.
2. **Messaging people who did not consent** risks Uncanned's WhatsApp number
   being restricted or banned. That would end the channel entirely.
3. **The access token can message the entire customer list.** Treat it like a
   bank password.

None of this means "be afraid to change things". It means test on your own
phone number first, every time.

---

## Getting set up

Requires Node 24 and PostgreSQL 16.

```bash
npm ci
cp .env.example .env
powershell -File deploy/generate-secrets.ps1
powershell -File scripts/bootstrap-db.ps1
npm run db:deploy
npm run db:seed
npm run dev
```

**Leave the WhatsApp settings empty on your own machine.** The app runs
perfectly well disconnected — it says so and disables sending. Almost every
feature can be built and tested that way, and a local copy connected to the
live WhatsApp account can send real messages to real customers by accident.

Connect WhatsApp locally only when you are specifically working on sending,
and when you do, keep the audience to your own number.

---

## Before every commit

```bash
npm run verify     # lint, typecheck, 163 tests
```

If it fails, the change is not finished. There is no "I will fix it later" —
this application sends messages to customers.

---

## The rules that are not negotiable

**Never commit `.env` or any secret.** It is git-ignored; keep it that way. If
you ever paste a token, key or password into a file, assume it is compromised
and tell Vamshi immediately — even if you delete it, it stays in git history.

**Never weaken the compliance gate.** `src/lib/campaigns/audience.ts` decides
who receives a marketing message. It requires a stored opt-in and excludes
anyone who opted out. If a change makes it "simpler" by skipping those checks,
the change is wrong.

**Never let an unapproved template be sent.** Approval is checked three times,
on purpose, because Meta can pause a template mid-campaign. Do not remove any
of them.

**Never put Meta credentials in client-side code.** Anything under
`src/lib/whatsapp/` is server-only. If you find yourself importing it into a
component marked `"use client"`, stop — that would ship the token to every
visitor's browser.

**Never bypass the confirmation step** on campaign sending. The checkbox, the
recipient count, and the idempotency key exist because someone will eventually
click Send twice.

---

## How the code is organised

```
src/
  app/(app)/          pages behind login
  app/(auth)/         login
  app/api/            webhook, CSV exports
  lib/
    whatsapp/         all Meta-specific code lives behind an interface
    campaigns/        audience resolution, sending, pricing
    contacts/         phone normalisation, CSV parsing
    webhooks/         incoming event processing
    auth/             passwords, sessions, guards
prisma/schema.prisma  the database
scripts/              diagnostics that run against a real database
deploy/               how it runs in production
```

**Server components by default.** Only add `"use client"` when you need state
or an event handler. Most pages do not.

**Every route and action checks permissions server-side** with `can()` or
`requireAuth()`. Hiding a button is presentation, not security.

---

## Areas to be careful in

| File | Why |
|---|---|
| `lib/campaigns/audience.ts` | Decides who gets messaged. Compliance lives here |
| `lib/campaigns/sender.ts` | Talks to Meta. Retry logic here can cause duplicate messages |
| `lib/webhooks/processor.ts` | Must stay idempotent — Meta retries and reorders events |
| `prisma/schema.prisma` | Unique constraints here prevent double sends. Do not remove any |
| `app/api/webhooks/` | Signature verification is this endpoint's only authentication |

If a change touches one of these, say so when you ask for review.

---

## Testing

Unit tests sit beside the code in `__tests__`. Integration scripts in
`scripts/` run against a real database and clean up after themselves:

```bash
npx tsx scripts/test-campaign.ts    # compliance gate, duplicate prevention
npx tsx scripts/test-webhook.ts     # idempotency, out-of-order statuses
npx tsx scripts/test-roles.ts       # every page as every role
```

**Write a test for anything with a rule in it.** Not for layout — for logic
that decides who gets a message, what a message says, or what something costs.
Several real bugs were caught this way, including one where variable values
would have been sent into the wrong placeholders.

---

## Deploying

The app runs on a machine in the office, reachable at
`https://whatsapp.uncanned.in` through a Cloudflare Tunnel.

**One command, run as Administrator on that machine:**

```powershell
cd C:\dev\uncanned-whatsapp
git pull
powershell -ExecutionPolicy Bypass -File deploy\update.ps1
```

It verifies, stops the app, builds, restarts, and checks that both localhost
and the public address answer. If the build fails it restarts the previous
version rather than leaving the app down.

**Never run `npm run build` on its own while the app is live.** Next.js loads
its build at startup and keeps referring to those files; replacing them under a
running process makes pages return 500 and can strip the styling entirely, with
nothing in the logs to explain it. This has already happened once. Build and
restart belong together, which is what `update.ps1` enforces.

### If a migration is involved

```powershell
npm run db:deploy      # applies migrations
```

Run it before `update.ps1`. Back up first — see below.

### After deploying

Check `https://whatsapp.uncanned.in/settings/logs`. The first line says when
WhatsApp last contacted the app. If that timestamp stops moving, incoming
messages are not arriving.

---

## Running it day to day

You own this. These are the things that keep it working.

### Back up the database

Nobody else is doing it.

```powershell
powershell -File deploy\backup.ps1
```

Schedule it daily in Task Scheduler, and copy the folder somewhere off that
machine occasionally. **A backup that has never been restored is not a
backup** — test one now and then.

### The machine must stay awake

Messages only arrive while it is on and online. If it sleeps or loses power,
incoming customer messages stop; Meta retries for a while, so short outages
recover, but long ones lose messages.

### When something is wrong

| Symptom | Where to look |
|---|---|
| Nothing arriving in the Inbox | `settings/logs` — when did WhatsApp last make contact? Then `Get-Service cloudflared` |
| Site not loading at all | `Get-ScheduledTask -TaskName UncannedWhatsApp`, then `Get-Service cloudflared` |
| Messages failing to send | `settings/logs` → the failure reason is in plain English; codes are under "View technical details" |
| Campaign stuck at "Sending" | Check the token has not been revoked: `npx tsx scripts/check-token.ts` |
| Page renders with no styling | The build was replaced under the running app. Run `update.ps1` |

### Useful checks

```bash
npx tsx scripts/check-token.ts       # does the access token still work, and does it expire
npx tsx scripts/account-health.ts    # quality rating, daily limit, display name status
npx tsx scripts/meta-spend.ts 30     # what Meta will actually bill
npx tsx scripts/test-roles.ts        # every page as every role
```

### Watch the quality rating

`account-health.ts` reports it, and the dashboard warns when it is not GREEN.
It falls when people block or report messages, and a sustained drop reduces how
many customers can be messaged per day. It is the single best indicator of
whether the messaging is well judged.

---

## Credentials you will hold

- **GitHub** — full access to this repository
- **The office machine** — Administrator, for deploys
- **Meta Business** — WhatsApp Manager, templates, phone number settings
- **Cloudflare** — the tunnel serving `whatsapp.uncanned.in`
- **The app** — an Administrator account

Two files on that machine matter more than the rest:

**`.env`** holds every secret. It is git-ignored. Never commit it, never paste
its contents anywhere, never put it in a ticket or a chat.

**`APP_ENCRYPTION_KEY`** inside `.env` decrypts the stored Meta access token.
If it is lost, the token must be entered again. **Back it up separately from
the database backup** — losing both together makes the backup's token
unrecoverable.

If a secret is ever exposed — committed, pasted, screenshotted — say so
immediately. Rotating a token takes two minutes; a quietly leaked one can be
used to message every customer Uncanned has.

---

## Conventions

- **British English** in anything a user reads
- **No jargon in the interface.** "Send campaign", not "execute POST". "This
  number is not on WhatsApp", not "error 131026"
- **Comments explain why, not what.** `// increment counter` is noise;
  `// Meta can deliver read before delivered, so only ever advance` is not
- Match the surrounding style rather than introducing a new one

---

## Before sending anything to real customers

Every time, without exception:

1. Build the campaign with an audience of **one contact — yourself**
2. Send it, and check it arrives on your own phone
3. Confirm the report shows delivered, then read
4. Only then build the real campaign

The confirmation screen tells you how many people will receive it and how many
were skipped, with reasons. **Read that screen properly.** It is the last point
at which a mistake is still free.

---

## Your first week

A reasonable order:

1. Get it running locally, disconnected from WhatsApp
2. Read `src/lib/campaigns/audience.ts` — the compliance gate is the heart of
   the system
3. Read `src/lib/webhooks/processor.ts` — idempotency and out-of-order events
4. Run the integration scripts and watch what they check
5. Make a small change, run `npm run verify`, deploy it, watch it go live

Then the open work: a pricing settings page, scheduled campaigns, WhatsApp
Flows, and a REST API so other Uncanned systems can trigger campaigns. There is
a plan for each in `docs/`.

---

## If you are unsure

Ask Vamshi. Particularly about anything that sends a message, changes who
receives one, or touches credentials.

"I was not sure so I did not touch it" is always a fine answer here. Nobody
minds a question; everybody minds five hundred people getting the wrong
message.
