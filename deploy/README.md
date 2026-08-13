# Deploying Uncanned WhatsApp on your own machine

This runs the app on a computer you own, reachable from the internet at your
own domain, at **no hosting cost and with no credit card**.

Cloudflare Tunnel creates a secure outbound connection from the machine to
Cloudflare's network, so nothing on your router or firewall needs opening.

**What you need**

- A computer that stays switched on and awake (the "server")
- Login for the Cloudflare account that already holds `uncanned.in`
- About 30 minutes

**What this gives you**

- `https://whatsapp.uncanned.in` — your team signs in from anywhere
- A stable webhook address for Meta, so incoming messages arrive
- HTTPS with a valid certificate, handled by Cloudflare
- Your customer data stays on your own machine

---

## Step 1 — Prepare the server machine

Windows 10/11 is assumed. The machine must not sleep.

**Stop it sleeping** — Settings → System → Power → Screen and sleep → set
**Sleep** to *Never* when plugged in. On a laptop, also set "closing the lid"
to *Do nothing* under Control Panel → Power Options → Choose what closing the
lid does.

**Install the prerequisites** (PowerShell as Administrator):

```powershell
winget install OpenJS.NodeJS.LTS
winget install PostgreSQL.PostgreSQL.16
winget install Git.Git
winget install Cloudflare.cloudflared
```

Restart PowerShell afterwards so `PATH` updates.

> PostgreSQL will ask for a superuser password during install. Write it down —
> you need it in Step 2.

---

## Step 2 — Set up the application

```powershell
git clone <your-repo-url> C:\dev\uncanned-whatsapp
cd C:\dev\uncanned-whatsapp
npm ci
```

Create the database and application role:

```powershell
powershell -File scripts\bootstrap-db.ps1 -SuperPassword "<the password you set>"
```

Create the configuration file:

```powershell
Copy-Item .env.example .env
powershell -File deploy\generate-secrets.ps1
```

`generate-secrets.ps1` fills in `AUTH_SECRET`, `APP_ENCRYPTION_KEY` and
`META_WEBHOOK_VERIFY_TOKEN` with cryptographically random values.

Then edit `.env` and set:

```
APP_URL="https://whatsapp.uncanned.in"
NODE_ENV="production"
```

> **Back up `APP_ENCRYPTION_KEY` somewhere safe.** It decrypts your stored Meta
> access token. If you lose it, you must re-enter the token.

Apply the database schema and create the first administrator:

```powershell
npm run db:deploy
npm run db:seed
npm run build
```

The seed prints the admin email and password. Change the password after your
first sign-in.

---

## Step 3 — Cloudflare

**Nothing to do.** `uncanned.in` is already on Cloudflare for the website, so
the domain is set up and the nameservers stay exactly as they are.

Step 4 adds a single DNS record for the `whatsapp` subdomain. Your website,
email and every existing record are untouched.

> You will need the login for the Cloudflare account that holds `uncanned.in`,
> because the next step opens a browser to authorise the tunnel.

---

## Step 4 — Create the tunnel

```powershell
cloudflared tunnel login
```

A browser opens. Sign in to the Cloudflare account that holds `uncanned.in`,
then select `uncanned.in` and authorise.

```powershell
cloudflared tunnel create uncanned-whatsapp
cloudflared tunnel route dns uncanned-whatsapp whatsapp.uncanned.in
```

The second command adds **one** DNS record — a proxied `CNAME` for
`whatsapp.uncanned.in` pointing at the tunnel. It does not read, change or
remove anything else in the zone, so your website and email are unaffected.

> If a `whatsapp` record already exists in that zone, the command fails rather
> than overwriting it. Delete or rename the old record first, or use a
> different subdomain such as `chat.uncanned.in`.

Create `C:\Users\<you>\.cloudflared\config.yml`:

```yaml
tunnel: uncanned-whatsapp
credentials-file: C:\Users\<you>\.cloudflared\<tunnel-id>.json

ingress:
  - hostname: whatsapp.uncanned.in
    service: http://localhost:3000
  - service: http_status:404
```

The tunnel ID is printed by `tunnel create` and is also the JSON filename.

Install it as a service so it starts with Windows:

```powershell
cloudflared service install
```

---

## Step 5 — Make it survive reboots

So nobody has to keep a terminal open, and the machine comes back on its own
after a Windows update restarts it overnight.

As Administrator:

```powershell
cd C:\dev\uncanned-whatsapp
powershell -ExecutionPolicy Bypass -File deploy\repair.ps1
```

One command, and it is safe to run at any time — it checks everything and
fixes only what is broken.

It registers three scheduled tasks:

| Task | What it does | When |
|---|---|---|
| `UncannedWhatsApp` | The web application on port 3000 | At startup, after a one minute delay |
| `UncannedWhatsAppScheduler` | Sends scheduled campaigns, resumes waiting conversations, picks up anything a restart interrupted | Every 5 minutes |
| `UncannedWhatsAppBackup` | Database backup to Google Drive | Daily at 2:30am |

The one minute delay is deliberate: "at startup" fires before networking and
PostgreSQL are ready, and an app that starts into a machine with no database
exits before Windows would retry it.

To check them, as Administrator:

```powershell
schtasks /query /fo TABLE | findstr /i uncanned
```

⚠️ **A normal terminal cannot see these tasks.** They run as SYSTEM, and an
unelevated `Get-ScheduledTask` reports them as missing rather than refusing —
which reads as "the task was never created" and has caused a wasted afternoon
more than once. Always check from an Administrator terminal.

To restart the app by hand:

```powershell
Stop-ScheduledTask -TaskName UncannedWhatsApp
Start-ScheduledTask -TaskName UncannedWhatsApp
```

---

## Step 6 — Point Meta at your webhook

In your Meta app → **WhatsApp → Configuration → Webhooks → Edit**:

| Field | Value |
|---|---|
| Callback URL | `https://whatsapp.uncanned.in/api/webhooks/whatsapp` |
| Verify token | the `META_WEBHOOK_VERIFY_TOKEN` value from your `.env` |

Click **Verify and save**. Meta calls your server immediately; if the tunnel
and app are running it succeeds straight away.

Then **Manage** the webhook fields and subscribe to:

- `messages` — incoming messages and delivery status
- `message_template_status_update` — template approvals and rejections
- `phone_number_quality_update` — early warning if your quality rating drops
- `account_update` — account-level restrictions

> ⚠️ A Meta app allows **one** callback URL. If AiSensy or anything else is
> still receiving your webhooks, this switches them off. Do it at a quiet time.

Finally, add the App Secret to `.env` and restart:

```
META_APP_ID="..."
META_APP_SECRET="..."
```

```powershell
Stop-ScheduledTask -TaskName UncannedWhatsApp
Start-ScheduledTask -TaskName UncannedWhatsApp
```

Without the App Secret the app cannot verify that incoming webhooks genuinely
came from Meta, and it will reject them all rather than trust them.

---

## Step 7 — Finish in the app

1. Open `https://whatsapp.uncanned.in` and sign in.
2. **Settings → WhatsApp connection** — enter WABA ID, Phone Number ID and your
   System User access token, then **Test connection**.
3. **Settings → Team members** — add your colleagues as Managers.
4. Change your own password under **Settings**.

---

## Keeping it healthy

**Backups run themselves**, daily at 2:30am, once `repair.ps1` has been run.
They go to Google Drive rather than this machine — a copy on the same disk as
the database survives none of the things that actually happen to a laptop.

```
G:\My Drive\Whatsapp Chats\
```

Nothing is ever deleted automatically. Each backup is about 0.03 MB, so a
decade of them is a few hundred megabytes.

To take one immediately:

```powershell
powershell -File deploy\backup.ps1
```

**Check a backup can actually be restored.** Worth doing every few months:

```powershell
powershell -File deploy\verify-backup.ps1
```

It restores the newest backup into a scratch database, counts the tables,
compares them against live, and throws the scratch database away. It never
touches the real one. A backup nobody has restored is a guess.

**Is it alive?** One address answers, with no login:

```
https://whatsapp.uncanned.in/api/health
```

The line that matters is `scheduler`. Every page keeps loading perfectly when
the scheduler dies, while scheduled campaigns and waiting conversations
quietly stop happening — this is the only thing that reveals it. Point a free
uptime monitor at this URL if you want to be told rather than to check.

**Updating:**

Double-click **Update Uncanned WhatsApp** on the Desktop, or:

```powershell
cd C:\dev\uncanned-whatsapp
powershell -ExecutionPolicy Bypass -File deploy\update.ps1
```

Never run `npm run build` while the app is running. It replaces the files
underneath the live process, and pages start returning errors with nothing in
the logs to explain it. `update.ps1` stops, builds, and restarts in the right
order for exactly this reason.

**If messages stop arriving,** check in this order:

1. Is the machine on and awake?
2. `Get-Service Uncanned*` — both Running?
3. `Get-Service cloudflared` — Running?
4. Does `https://whatsapp.uncanned.in/login` load from your phone?
5. **Settings → Activity log** in the app.

---

## Honest limitations

- **If the machine is off, incoming messages do not arrive.** Meta retries for
  a while, so a short outage usually catches up — but a long one loses
  messages.
- **No automatic failover.** One machine, one point of failure.
- **You own backups, updates and security patches.**

For an internal tool used by three people this is a reasonable trade. If
Uncanned later depends on WhatsApp for revenue, a €4/month virtual server
removes all three, and the same steps apply.
