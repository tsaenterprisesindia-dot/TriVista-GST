# Deploy to Railway (production)

This repo is Railway-ready: one root `package.json` (Nixpacks auto-detects
Node), `railway.json` (healthcheck `/api/health`, restart-on-failure), and a
backend `start` script. The backend boots the API **and** serves the built
`frontend/dist`. Everything below needs only the Railway dashboard — no code
edits, no Dockerfiles.

## One-time (≈5 minutes)

1. Go to https://railway.app and sign in (GitHub OAuth).
2. **New Project** -> **Deploy from GitHub repo** -> select
   `tsaenterprisesindia-dot/TriVista-GST` -> **Deploy Service**.
   Railway auto-detects Node via Nixpacks and runs `npm run build` (→ dist)
   then `npm start` (→ backend). Watch the build log until
   `/api/health` reports 200.
3. **+ New** -> **Database** -> **MySQL**. Railway creates a managed DB.
   Click the new MySQL service, open **Variables**, and copy these five into
   the **App** service's Variables (Railway gives them to you):
   - `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`

## Variables to set on the App service

Open the App service -> **Variables** -> add each row below. Use Railway's
**Generate** button for the secret values.

| Variable          | Value / where from                                   |
|-------------------|------------------------------------------------------|
| `DB_HOST`         | from the MySQL addon                                 |
| `DB_PORT`         | from the MySQL addon                                 |
| `DB_USER`         | from the MySQL addon                                 |
| `DB_PASSWORD`     | from the MySQL addon                                 |
| `DB_NAME`         | from the MySQL addon                                 |
| `JWT_SECRET`      | Generate — long random                              |
| `CRYPTO_SECRET`   | Generate — long random (same rules as local secret.js) |
| `CORS_ORIGIN`     | `https://<your-service>.up.railway.app`             |
| `PORT`            | leave unset (Railway injects it)                    |

That is the minimum for **sign-in + Dashboard + POS + invoicing** to work.

## Opt-in extras (fill in later — no redeploy needed)

Once the app is up, open Settings -> company -> enable each feature, then add
its secrets to Variables (invoice/e-invoice, AI assistant, DSR/gst filing).
The full set is documented with placeholders in the repo's `.env.example`
(`DB_*`, `JWT_*`, `CRYPTO_SECRET`, `CORS_ORIGIN`, `GSTN`/e-invoice, `EWB_*`,
`IRP_*`, `GSTR1_JSON_VERSION`, `DEFAULT_*` company seed, `MYSQL_BIN`).

## Cost / free credit

Railway gives new accounts a trial credit (no card required) that comfortably
covers the MySQL addon + one App service for testing. Validated deploy goes
live in ~2 minutes; no card needed to start.

## Local-first note

If you keep using this app locally (XAMPP MySQL on Windows), just don't set
`DB_*` envs — the backend falls back to localhost defaults. Railway and local
are independent.
