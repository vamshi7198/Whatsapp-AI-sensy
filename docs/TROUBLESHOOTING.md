# When something is wrong

Symptoms first, because that is what you actually have.

Almost everything here is fixed by one command, run in **PowerShell as
Administrator**:

```powershell
powershell -File deploy\repair.ps1
```

It checks the database, the app, the tunnel and all three scheduled tasks, and
puts back whatever is missing. It is safe to run when nothing is wrong.

---

## The site does not load at all

**`whatsapp.uncanned.in` times out or shows a Cloudflare error**

1. Is the machine on and awake? It cannot serve anything asleep. Settings →
   System → Power → Sleep = *Never* when plugged in, and on a laptop set
   closing the lid to *Do nothing*.
2. Run `deploy\repair.ps1` as administrator.
3. Check the tunnel specifically — a working app behind a dead tunnel looks
   identical from outside:

   ```powershell
   Get-Process cloudflared -ErrorAction SilentlyContinue
   ```

**Nothing was lost while it was down.** Messages sent to the WhatsApp number
during an outage are redelivered by Meta for up to 7 days and appear once the
app is back.

---

## The site loads but looks broken — no styling, plain HTML

Someone ran `npm run build` against the running app. The build replaces the
files the live site is serving while it is serving them.

```powershell
powershell -File deploy\update.ps1
```

Always use `update.ps1` to deploy. It builds separately and swaps the result
in, which is exactly the problem it exists to avoid.

---

## Scheduled campaigns are not sending / journeys are stuck waiting

The app shows an amber banner reading **"Background tasks last ran N minutes
ago"**, or `/api/health` reports `scheduler: stalled`.

The scheduler is the only thing that sends scheduled campaigns and resumes
journeys waiting on a timer. Every page keeps working perfectly without it,
which is why this is worth a banner.

```powershell
powershell -File deploy\repair.ps1
```

Then confirm a pass actually ran — it writes a line every time, whether it
worked or not:

```powershell
Get-Content logs\uncanned-*.log -Tail 5
```

You are looking for `"Scheduler pass complete"`. If the log shows an error
instead, that error is the real problem.

Nothing is lost by a late pass. A campaign whose time passed is sent late
rather than skipped.

---

## Backups are not happening

`/api/health` reports `backup: stale Nh`, `never sent offsite`, or
`none taken`.

Check the transcript first — every run leaves one, successful or not:

```powershell
Get-Content logs\backup-*.log -Tail 30
```

Then in order of likelihood:

1. **Is Google Drive signed in?** `G:` only exists while it is. Open File
   Explorer and look for `G:\My Drive`.
2. **Is the task running as your user?** It must be — SYSTEM has no `G:` drive
   at all, because Drive mounts it per-session. `repair.ps1` registers it
   correctly; re-run it if unsure.
3. **Take one by hand** to see the error directly:

   ```powershell
   powershell -File deploy\backup.ps1
   ```

`never sent offsite` specifically means dumps ARE being taken but are landing
in `backups\` on this machine instead of Drive. That is a warning, not a
success: a copy on the same disk as the database survives none of the things
that actually happen to laptops.

---

## Messages are not arriving from customers

1. **Check the number is receiving at all** — send a WhatsApp message to it
   from a phone that is not in the system.
2. **Check Meta can reach the webhook.** In Meta Business Manager →
   WhatsApp → Configuration, the callback URL must be
   `https://whatsapp.uncanned.in/api/webhooks/whatsapp` and subscribed to
   `messages`.
3. **Look at Settings → Activity log.** Every webhook Meta sends is recorded
   there before anything is done with it, so if messages appear in that log the
   problem is downstream, and if they do not, the problem is Meta reaching us.

A message that arrived while the app was down is not lost. Meta retries for up
to 7 days, and the scheduler's recovery pass applies anything stored but not
yet processed.

---

## A campaign stopped part-way

Open the campaign. The reason is on the page.

| What it says | What happened |
|---|---|
| Template no longer approved | Meta paused or rejected the template mid-send |
| WhatsApp is not connected | Credentials missing or rejected |
| An access token problem | The token expired or was revoked |
| Cancelled | Somebody pressed Stop |

In every case the people who were **not** reached are offered under
**Resend** — including those sending never got to, not only those it tried and
failed. Fix the underlying cause first, or the resend fails the same way.

---

## Everyone is locked out — no administrator

Recoverable only from the machine itself:

```powershell
npx tsx scripts/set-admin.ts someone@uncanned.in
```

---

## A contact says they still get marketing after opting out

Check **Contacts → the contact → Opt-out history**. Every opt-out writes an
audit row saying when it happened and what caused it, because a boolean on its
own proves nothing if the request is ever disputed.

If the flag is set and messages still went out, that is a genuine bug worth
investigating rather than a configuration mistake — the send path re-checks
opt-out immediately before each message, not only when the audience was built.

---

## Reading the logs

```powershell
Get-Content logs\uncanned-2026-08-15.log -Tail 50   # app and scheduler
Get-Content logs\backup-2026-08-15.log -Tail 30     # backups
```

One JSON object per line. `"level":50` is an error, `40` a warning, `30`
information. Phone numbers are masked and no access token is ever written.
