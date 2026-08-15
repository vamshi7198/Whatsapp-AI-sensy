# Backups

Running the app yourself means the data is yours, which also means nobody else
is backing it up.

---

## What happens, and where it goes

`deploy\backup.ps1` runs daily at **02:30**, dumps the PostgreSQL database,
compresses it, and copies the archive to:

```
G:\My Drive\Whatsapp Chats\uncanned_YYYY-MM-DD_HHMMSS.sql.zip
```

About 40 KB today. A decade of daily backups is a few hundred megabytes in
Drive, which is why **nothing is ever pruned** — the only thing automatic
deletion could achieve here is losing the copy somebody eventually needs.

**The finished backup goes off this machine and is not kept on it.** A copy on
the same disk as the database protects against nothing that actually happens to
a laptop: a failed drive, a theft, ransomware. The one exception is when the
offsite copy fails — then it is kept in `backups\` locally rather than thrown
away, the script says so loudly, and `/api/health` reports
`backup: never sent offsite`. A local backup beats none, but it is not the job
done.

**The task runs as your user account, not SYSTEM.** Google Drive's `G:` is a
virtual drive mounted inside a signed-in session — `Get-Volume -DriveLetter G`
returns nothing, because the machine has no such volume. SYSTEM has no session
and therefore no `G:`, whatever permissions it holds. Drive itself only runs in
your session too, so there is no principal that both has admin rights and can
reach the folder. A run missed overnight is taken at the next sign-in.

---

## Taking one now

```powershell
powershell -File deploy\backup.ps1
```

Every run writes a transcript to `logs\backup-YYYY-MM-DD.log`, including
failures. A scheduled run has no console, so without that a failure would leave
no trace of any kind.

---

## Checking one — do this monthly

A backup that has never been restored is not yet known to be a backup.

```powershell
powershell -File deploy\verify-backup.ps1
```

It restores the newest archive into a scratch database, counts the rows in
every table, compares them against the live database, and drops the scratch.
Nothing it does touches live data.

---

## Restoring

**This replaces the live database. Take a backup of the current state first,
even if you believe it is broken — you cannot get back what you overwrite.**

```powershell
# 1. Stop the app so nothing writes during the restore
Stop-ScheduledTask -TaskName "UncannedWhatsApp"
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Unzip the backup you want
Expand-Archive "G:\My Drive\Whatsapp Chats\uncanned_2026-08-15_023000.sql.zip" -DestinationPath $env:TEMP\restore

# 3. Recreate the database empty
$env:PGPASSWORD = "<password from .env DATABASE_URL>"
& "C:\Program Files\PostgreSQL\16\bin\dropdb.exe"   -U uncanned -h localhost uncanned_whatsapp
& "C:\Program Files\PostgreSQL\16\bin\createdb.exe" -U uncanned -h localhost uncanned_whatsapp

# 4. Load it
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U uncanned -h localhost -d uncanned_whatsapp -f "$env:TEMP\restore\uncanned_2026-08-15_023000.sql"

# 5. Start everything again
powershell -File deploy\repair.ps1
```

> ⚠️ **Do not pass SQL inline with `psql -c "SELECT ... FROM \"Contact\""`.**
> PowerShell strips the inner double quotes before `psql` sees them, so
> `"Contact"` arrives as `Contact`, which PostgreSQL lowercases to a table that
> does not exist. Worse, `"User"` appears to work — unquoted `user` is a
> reserved word that returns the current username, so the query succeeds and
> reports something entirely unrelated. Always use `-f` with a file.

---

## What a backup does and does not contain

**Contains** — every contact, every message, campaigns and their results,
journeys, automations, templates, opt-out records, users, and the audit log.

**Does not contain** — the `.env` file. That holds the database password, the
session secret and the encryption key for the Meta access token. Without it the
Meta token in a restored database **cannot be decrypted** and will need
re-entering.

**Keep a copy of `.env` somewhere safe and separate from the backups.** It is
the one thing that is not in them and is needed to use them.

---

## How much could be lost

Backups run daily, so up to about 24 hours of database changes.

Customer messages are more resilient than that figure suggests: Meta redelivers
webhooks for up to 7 days, so inbound messages received after the last backup
arrive again once the app is running. Campaign send records and journey
progress in that window are genuinely lost and would need re-running.
