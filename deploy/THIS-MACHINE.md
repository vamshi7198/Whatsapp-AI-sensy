# Deploying on this machine

Written for the computer you are already working on, where Node, PostgreSQL,
the database and a production build are all in place.

Everything below can be undone, and moving to a different machine later is a
30-minute job — see **Moving to another machine** at the end.

---

## Before you start: what running this on a laptop means

The app can only receive customer messages while this machine is **on, awake
and online**.

| Situation | What happens |
|---|---|
| Lid closed / asleep | Messages stop arriving. Meta retries for a while, so a short closure usually catches up |
| Shut down overnight | Messages sent overnight arrive late or not at all |
| Wi-Fi drops briefly | Cloudflare reconnects automatically |
| You keep working normally | Fine — the app uses very little while idle |

Sleep-on-mains is already disabled on this machine. The remaining risk is
**closing the lid**, so set that too:

1. Control Panel → Hardware and Sound → Power Options
2. **Choose what closing the lid does**
3. Set *When I close the lid* → **Do nothing** (at least for "Plugged in")

If that is not acceptable day-to-day, this is the strongest argument for
moving to a dedicated machine later.

---

## Step 1 — Configure the app for production

Open `C:\dev\uncanned-whatsapp\.env` in a text editor and change:

```
APP_URL="https://whatsapp.uncanned.in"
NODE_ENV="production"
```

Add your Meta app details on the same file (from Meta app → Settings → Basic):

```
META_APP_ID="your app id"
META_APP_SECRET="your app secret"
```

> The App Secret is what proves an incoming webhook genuinely came from Meta.
> Without it every incoming message is rejected, which is the correct
> behaviour but means the inbox stays empty.

Leave `AUTH_SECRET`, `APP_ENCRYPTION_KEY` and `META_WEBHOOK_VERIFY_TOKEN`
exactly as they are.

Then rebuild:

```powershell
cd C:\dev\uncanned-whatsapp
npm run build
```

---

## Step 2 — Create the Cloudflare tunnel

`uncanned.in` is already on Cloudflare, so nothing about your website or email
changes. This adds one DNS record for the `whatsapp` subdomain.

```powershell
cloudflared tunnel login
```

A browser opens. Sign in to the Cloudflare account that holds `uncanned.in`,
select `uncanned.in`, and click **Authorize**.

```powershell
cloudflared tunnel create uncanned-whatsapp
```

Note the **tunnel ID** it prints — a long id like
`6ff42ae2-765d-4adf-8112-31c55c101112`.

```powershell
cloudflared tunnel route dns uncanned-whatsapp whatsapp.uncanned.in
```

This creates a single proxied `CNAME` for `whatsapp.uncanned.in`. It reads and
changes nothing else in the zone.

---

## Step 3 — Write the tunnel config

Create the file `C:\Users\vamsh\.cloudflared\config.yml`:

```yaml
tunnel: uncanned-whatsapp
credentials-file: C:\Users\vamsh\.cloudflared\<tunnel-id>.json

ingress:
  - hostname: whatsapp.uncanned.in
    service: http://localhost:3000
  - service: http_status:404
```

Replace `<tunnel-id>` with the id from Step 2 — it is also the name of the
`.json` file already sitting in that folder.

---

## Step 4 — Make it start automatically

One script does everything that needs Administrator: registers the app to
start with Windows, and installs the tunnel as a service.

```powershell
# Run PowerShell as Administrator
cd C:\dev\uncanned-whatsapp
powershell -ExecutionPolicy Bypass -File deploy\setup-autostart.ps1
```

It uses Windows Task Scheduler rather than a third-party service wrapper, so
there is nothing extra to install. The task runs at startup as SYSTEM, so the
app comes back after a reboot without anyone needing to log in.

Check it worked:

```powershell
Get-ScheduledTask -TaskName UncannedWhatsApp
Get-Service cloudflared
```

Then open **https://whatsapp.uncanned.in** — from your phone, ideally, to
prove it is genuinely reachable from outside.

---

## Step 5 — Point Meta at it

In your Meta app → **WhatsApp → Configuration → Webhooks → Edit**:

| Field | Value |
|---|---|
| Callback URL | `https://whatsapp.uncanned.in/api/webhooks/whatsapp` |
| Verify token | the `META_WEBHOOK_VERIFY_TOKEN` line from your `.env` |

Click **Verify and save**. Meta calls the server immediately — if the tunnel
and app are running, it succeeds at once.

Then **Manage** the webhook fields and subscribe to:

- `messages`
- `message_template_status_update`
- `phone_number_quality_update`
- `account_update`

> ⚠️ A Meta app allows **one** callback URL. If AiSensy still holds it, this
> switches it over. Do it at a quiet time.

---

## Step 6 — Finish inside the app

1. Sign in at `https://whatsapp.uncanned.in`
2. **Settings → WhatsApp connection** — enter WABA ID, Phone Number ID and your
   System User access token → **Test connection**
3. **Templates → Sync from WhatsApp**
4. **Settings → Team members** — add your colleagues as Managers
5. Change your own password under **Settings**

**First real send: use your own number only.** Create a campaign whose audience
is a single contact — yourself. Confirm it arrives and that the report shows
delivered and read. Only then send to customers.

---

## Day-to-day

**Back up the database.** Nobody else is doing it.

```powershell
powershell -File deploy\backup.ps1
```

Schedule it daily in Task Scheduler and copy the folder somewhere else
occasionally — a backup stored only on this machine is not a backup.

**Restart after changing `.env`:**

```powershell
Restart-Service UncannedWhatsAppWeb
```

**If messages stop arriving:** machine awake? → `Get-Service Uncanned*,
cloudflared` both Running? → does the site load on your phone?

---

## Moving to another machine later

Straightforward, and nothing is locked to this computer. Roughly 30 minutes.

**On the old machine — take three things:**

```powershell
# 1. A database dump
powershell -File deploy\backup.ps1

# 2. Your .env file (contains the encryption key)
copy C:\dev\uncanned-whatsapp\.env D:\somewhere-safe\

# 3. The tunnel credentials
copy C:\Users\vamsh\.cloudflared\*.json D:\somewhere-safe\
```

**On the new machine:**

1. Install Node 24, PostgreSQL 16, cloudflared, nssm (same commands as before)
2. `git clone` the project, `npm ci`
3. Run `scripts\bootstrap-db.ps1`, then restore the dump:
   ```powershell
   psql -U uncanned -d uncanned_whatsapp -f uncanned_<date>.sql
   ```
4. Copy the saved `.env` into place
5. Copy the tunnel `.json` into `C:\Users\<newuser>\.cloudflared\`, write
   `config.yml` with the new path, run `cloudflared service install`
6. `npm run build`, then `deploy\install-services.ps1`

**Nothing in Meta changes.** The webhook URL, the domain and the tunnel stay
the same — Cloudflare simply routes to wherever the tunnel is now running. Your
team notices nothing.

> ⚠️ **`APP_ENCRYPTION_KEY` must be the same on the new machine.** It decrypts
> the stored Meta access token. If you lose it, everything else still works —
> you just re-enter the token in Settings.

**Stop the tunnel on the old machine** before starting it on the new one:

```powershell
Stop-Service cloudflared
```

Running both at once splits traffic unpredictably between them.
