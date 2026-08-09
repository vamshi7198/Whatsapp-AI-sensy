# Deploying Uncanned WhatsApp on your own machine

This runs the app on a computer you own, reachable from the internet at your
own domain, at **no hosting cost and with no credit card**.

Cloudflare Tunnel creates a secure outbound connection from the machine to
Cloudflare's network, so nothing on your router or firewall needs opening.

**What you need**

- A computer that stays switched on and awake (the "server")
- A domain you own, e.g. `uncanned.in`
- A free Cloudflare account (no card)
- About 45 minutes

**What this gives you**

- `https://whatsapp.yourdomain.com` — your team signs in from anywhere
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
git clone <your-repo-url> C:\uncanned
cd C:\uncanned
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
APP_URL="https://whatsapp.yourdomain.com"
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

## Step 3 — Connect your domain to Cloudflare

1. Sign up at [cloudflare.com](https://dash.cloudflare.com/sign-up) — free, no card.
2. **Add a site** → enter your domain → choose the **Free** plan.
3. Cloudflare shows two nameservers. Set these at your domain registrar
   (GoDaddy, BigRock, Namecheap, wherever you bought the domain), replacing the
   existing ones.
4. Wait for Cloudflare to confirm the domain is active. This usually takes
   under an hour but can take up to 24.

> This does **not** move your website or email. It only changes who answers DNS
> lookups. Existing records are copied across during setup — check them before
> you finish.

---

## Step 4 — Create the tunnel

```powershell
cloudflared tunnel login
```

A browser opens; choose your domain and authorise.

```powershell
cloudflared tunnel create uncanned-whatsapp
cloudflared tunnel route dns uncanned-whatsapp whatsapp.yourdomain.com
```

Create `C:\Users\<you>\.cloudflared\config.yml`:

```yaml
tunnel: uncanned-whatsapp
credentials-file: C:\Users\<you>\.cloudflared\<tunnel-id>.json

ingress:
  - hostname: whatsapp.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

The tunnel ID is printed by `tunnel create` and is also the JSON filename.

Install it as a service so it starts with Windows:

```powershell
cloudflared service install
```

---

## Step 5 — Run the app as a Windows service

So it survives reboots and nobody has to keep a terminal open.

```powershell
winget install nssm.nssm
```

Then, as Administrator:

```powershell
powershell -File deploy\install-services.ps1
```

This registers two services:

| Service | What it does |
|---|---|
| `UncannedWhatsAppWeb` | The web application on port 3000 |
| `UncannedWhatsAppWorker` | Background sending (needed from campaigns onward) |

Manage them from Services (`services.msc`) or:

```powershell
Restart-Service UncannedWhatsAppWeb
Get-Service Uncanned*
```

---

## Step 6 — Point Meta at your webhook

In your Meta app → **WhatsApp → Configuration → Webhooks → Edit**:

| Field | Value |
|---|---|
| Callback URL | `https://whatsapp.yourdomain.com/api/webhooks/whatsapp` |
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
Restart-Service UncannedWhatsAppWeb
```

Without the App Secret the app cannot verify that incoming webhooks genuinely
came from Meta, and it will reject them all rather than trust them.

---

## Step 7 — Finish in the app

1. Open `https://whatsapp.yourdomain.com` and sign in.
2. **Settings → WhatsApp connection** — enter WABA ID, Phone Number ID and your
   System User access token, then **Test connection**.
3. **Settings → Team members** — add your colleagues as Managers.
4. Change your own password under **Settings**.

---

## Keeping it healthy

**Back up the database.** The whole point of running it yourself is that the
data is yours — which also means nobody else is backing it up.

```powershell
powershell -File deploy\backup.ps1
```

Schedule it daily via Task Scheduler. Keep a copy off the machine.

**Updating:**

```powershell
cd C:\uncanned
git pull
npm ci
npm run db:deploy
npm run build
Restart-Service UncannedWhatsAppWeb, UncannedWhatsAppWorker
```

**If messages stop arriving,** check in this order:

1. Is the machine on and awake?
2. `Get-Service Uncanned*` — both Running?
3. `Get-Service cloudflared` — Running?
4. Does `https://whatsapp.yourdomain.com/login` load from your phone?
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
