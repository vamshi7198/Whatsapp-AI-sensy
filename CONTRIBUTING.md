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

Leave the WhatsApp settings empty. **Develop against a disconnected app** — it
runs perfectly well without Meta credentials and simply says WhatsApp is not
connected. You do not need real credentials to build features, and you should
not have them.

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

Do not deploy. Ask Vamshi.

For context: the app runs on a machine in the office and updates with
`deploy/update.ps1`, which builds and restarts together. Running `npm run
build` on its own while the app is live replaces the build underneath a running
process and breaks it.

---

## Conventions

- **British English** in anything a user reads
- **No jargon in the interface.** "Send campaign", not "execute POST". "This
  number is not on WhatsApp", not "error 131026"
- **Comments explain why, not what.** `// increment counter` is noise;
  `// Meta can deliver read before delivered, so only ever advance` is not
- Match the surrounding style rather than introducing a new one

---

## If you are unsure

Ask. Particularly about anything that sends a message, changes who receives
one, or touches credentials.

"I was not sure so I did not touch it" is always a fine answer here.
