# Running Uncanned WhatsApp

What keeps this working day to day, and the handful of things worth looking at.

Setting the machine up in the first place is [deploy/README.md](../deploy/README.md).
When something is wrong, [TROUBLESHOOTING.md](TROUBLESHOOTING.md) goes symptom
by symptom.

---

## The three scheduled tasks

Everything that happens without somebody clicking is one of these. They run as
Windows scheduled tasks, registered by `deploy\repair.ps1`.

| Task | When | What it does |
|---|---|---|
| `UncannedWhatsApp` | At startup, +1 min | Starts the web app and the Cloudflare tunnel |
| `UncannedWhatsAppScheduler` | Every 5 minutes | Recovers stored webhooks, resumes waiting journeys, sends scheduled campaigns |
| `UncannedWhatsAppBackup` | Daily 02:30 | Dumps the database and copies it to Google Drive |

The first two run as **SYSTEM**, so they work whether or not anyone is signed
in. The backup runs as **your user account**, because Google Drive's `G:` is a
virtual drive that only exists inside a signed-in session — SYSTEM cannot see
it at all. A backup missed overnight is taken at the next sign-in.

> ⚠️ **Checking whether a task exists needs an elevated PowerShell.**
> Without elevation, `Get-ScheduledTask` reports SYSTEM tasks as *missing*
> rather than as access-denied, which has caused two wrong diagnoses on this
> project. `schtasks /query /tn "UncannedWhatsApp"` is the reliable check:
> *"Access is denied"* means it exists and you lack rights to read it;
> *"cannot find the file specified"* means it genuinely is not there.

---

## The one number worth watching

`https://whatsapp.uncanned.in/api/health`

```json
{"status":"ok","checks":{"database":"ok","scheduler":"ok","messageQueue":"ok",
 "campaigns":"ok","whatsapp":"configured","backup":"ok"}}
```

It needs no login and reveals nothing private — no token, no phone number, not
even the length of a secret. `status` is `ok` or `degraded`.

**It returns HTTP 200 even when degraded, deliberately.** An uptime monitor
watching for a non-200 would page for a stale backup at three in the morning.
Read the `status` field, not the HTTP code.

| Check | Says `ok` when |
|---|---|
| `database` | The database answered |
| `scheduler` | A scheduler pass finished within 20 minutes |
| `messageQueue` | Fewer than 50 webhook events are waiting |
| `campaigns` | Informational only — never degrades the status |
| `whatsapp` | Meta credentials are saved |
| `backup` | A backup reached **Google Drive** within 30 hours |

`backup` is judged on reaching Drive, not on a dump having run. A copy sitting
on the same disk as the database is not protection, so a local-only fallback
reads `never sent offsite` and degrades.

**In the app**, a stale scheduler also raises a banner on every page. That
exists because nobody reliably reads a health endpoint, and a dead scheduler is
invisible otherwise — every page keeps loading perfectly while scheduled
campaigns silently stop going out.

---

## What survives being switched off

The machine can be off overnight, over a weekend, or for a few days without
losing anything.

- **Meta retries webhooks for up to 7 days.** Anything that arrives while the
  machine is off is redelivered when it comes back.
- **Inbound webhooks are stored before they are acted on**, so a crash between
  receiving and applying loses nothing — the scheduler's recovery pass picks it
  up within five minutes.
- **A campaign scheduled for a time that passed while the machine was off is
  sent late, not skipped.** Late is recoverable; never sending is not.

The real limit is **7 days**. Past that Meta stops retrying and those messages
are gone for good. If the machine will be off longer than a week, that is worth
planning around.

---

## Routine

**Weekly** — open the app. If there is no amber banner and `/api/health` says
`ok`, nothing needs doing.

**Monthly** — restore a backup and check it:

```powershell
powershell -File deploy\verify-backup.ps1
```

It restores the newest backup into a scratch database, compares the table
counts against the live one, and drops the scratch. A backup that has never
been restored is not yet known to be a backup.

**After any code change** — always deploy with:

```powershell
powershell -File deploy\update.ps1
```

Never run `npm run build` directly against the running app. Doing so replaces
the assets the live site is serving mid-request and produces a stylesheet-less
site until it finishes. That happened once on this project; `update.ps1` builds
elsewhere and swaps the result in.

---

## Costs

Meta bills per message, and only for messages actually **delivered** — a failed
send costs nothing, which is why the app offers every failure for resend
without hesitation.

Spend is tracked in INR under **Reports → Spend**. Two figures exist and are
not the same:

- **Estimated cost** — summed from each message, always correct.
- **Campaign `actualCost`** — a per-campaign running total, recomputable from
  the messages if it ever looks wrong.

From **1 October 2026** Meta begins charging for service messages and utility
templates sent inside an open 24-hour window. Those are free today, so the bill
will step up on that date without anything in this app changing.
