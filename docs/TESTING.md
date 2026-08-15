# Testing

Two kinds, for two different reasons.

---

## Unit tests

```powershell
npm test          # once
npm run test:watch
```

249 tests across 24 files. Pure functions only — no database, no network — so
they run in about four seconds and can be run constantly.

They cover the decisions that are easy to get subtly wrong and expensive to get
wrong in production: phone normalisation, CSV parsing and escaping, the
24-hour service window, error classification, pricing, message-length limits,
and the health assessments.

**Several exist because the obvious implementation was wrong.** Those tests
name the bug in a comment rather than just asserting the fix, because the same
mistake is easy to reintroduce:

- `backup-health.test.ts` asserts `healthy`, not just the label. The original
  bug set a perfect label and never touched `healthy`, so the endpoint reported
  `{"status":"ok"}` with `"backup":"stale 500h"` inside it. A test asserting
  only the label would have passed against the broken version.
- `network.test.ts` fixes the direction the classification must fail in. An
  unrecognised network error treated as retryable costs a customer a duplicate
  WhatsApp message; treated as ambiguous it costs somebody a glance.
- `service.test.ts` (templates) checks that an empty sync disables **nothing**,
  and includes the naive version alongside to show what it must not do.

---

## Database tests

```powershell
npx tsx scripts/test-journeys.ts
npx tsx scripts/test-journey-reentry.ts
npx tsx scripts/test-journey-concurrency.ts
npx tsx scripts/test-contact-fields.ts
npx tsx scripts/test-automations.ts
npx tsx scripts/test-retry.ts
npx tsx scripts/test-tag-references.ts
```

These run against the **real development database** and clean up after
themselves, including on failure.

They exist because what they test *is* the database's behaviour, and a mock
cannot be wrong about it in the way that matters:

| Script | What only a real database can prove |
|---|---|
| `test-journey-reentry` | The partial unique index covers exactly the in-flight statuses — Prisma cannot express one, so `migrate dev` will offer to drop it |
| `test-journey-concurrency` | Of two simultaneous advances exactly one wins, and the loser is told it changed nothing |
| `test-tag-references` | A JSON containment query actually matches. The first attempt used Prisma's `string_contains`, which matches JSON string *values* rather than the document, so the guard silently found nothing |
| `test-retry` | Two clicks carrying one idempotency key produce one campaign |
| `test-automations` | Two overlapping rules reply once, not twice |

None of them contact WhatsApp, so no message is ever sent.

> `test-automations` uses phrases containing no live keyword. A real "Hi" rule
> in the database will match a test phrase containing "Hi" and, because only
> the first matching automation replies, make the test fail for a reason that
> has nothing to do with the code.

---

## Before deploying

```powershell
npm test
npx tsc --noEmit
npm run lint
```

Then deploy with `deploy\update.ps1` — never `npm run build` against the
running app.

---

## What is not covered

**No test sends a real WhatsApp message.** Everything past the point where the
provider is called is verified by reading Meta's response handling, not by
observing a delivery. End-to-end confidence needs a real send to a real phone.

**No browser tests.** The React canvas, the campaign wizard and the inbox are
checked by hand.

**Load is untested.** The largest campaign this has run is small. The
50,000-row limits on imports and audience uploads are bounds chosen to sit well
inside PostgreSQL's parameter limits, not figures measured under load.
