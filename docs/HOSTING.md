# Deployment / Hosting Guide

TriVista GST is a standard Node.js + MySQL/MariaDB stack. Production build serves the single-page React app from the Express backend.

## Windows development machine (this project)

The dev database is **MariaDB via XAMPP** at `H:\xampp\mysql`:
- Binaries: `H:\xampp\mysql\bin\` · Data: `H:\xampp\mysql\data\` · Config: `H:\xampp\mysql\bin\my.ini` (port 3306, root, no password).
- Manage it: `scripts\start-db.ps1` (start), `scripts\stop-db.ps1` (stop), or the one-shot `scripts\start-all.ps1` (DB + API :5000 + frontend :5173).
- Backups of the data live in `H:\TriveniGST\backups\` (full dumps of `triveni_gst_erp`, `tsa`, `college_notes` taken 2026-09-08).

## Recommended (small business)

**Hostinger VPS (India region) â€” KR, â‚¹350â€“600/mo, Ubuntu 24.04**
- 2 GB RAM, 1 vCPU is enough for a busy single-branch store (Node ~50 MB + MySQL ~200 MB).
- Lowest friction for GST e-invoice/e-way bill outward calls and GSTR exports.

Alternatives:
- Shared hosting (Hostinger / Bluehost) with Node support + MySQL â€” cheapest, fine for a single shop, but Node hosting can be limited.
- Cloud (Render/Railway/Fly.io + Neon/PlanetScale/RDS MySQL) â€” better for multi-branch/expansion, but keep an India-region server if you care about latency to GSTN.

## Steps (Ubuntu VPS)

```bash
# 1. Packages
sudo apt update && sudo apt install -y nodejs npm mysql-server nginx git
node -v   # should be 18+; if not, enable NodeSource repo

# 2. MySQL
sudo mysql -e "CREATE DATABASE triveni_gst_erp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER 'triveni'@'localhost' IDENTIFIED BY 'STRONG_PASSWORD';"
sudo mysql -e "GRANT ALL PRIVILEGES ON triveni_gst_erp.* TO 'triveni'@'localhost'; FLUSH PRIVILEGES;"

# 3. App
cd /srv
sudo git clone <your-repo> triveni
cd triveni/backend
npm install --omit=dev
cp .env.example .env   # edit DB_USER=triveni, DB_PASSWORD, JWT_SECRET, CORS_ORIGIN
npm run db:init
npm run db:seed

# 4. Production frontend build (frontend is served as static files by the API server)
cd ../frontend
npm install
npm run build
```

Then serve the built `frontend/dist` from the backend with one of:

```bash
# Option A: use the built-in static serving (server.js serves dist/ if present)
cd ../backend
node src/server.js
```

If the backend does not yet auto-serve `frontend/dist`, either extend `server.js` with `express.static` for the `../frontend/dist` folder (SPA fallback to index.html), or run nginx:

```nginx
server {
  listen 80;
  server_name yourdomain.in;
  root /srv/triveni/frontend/dist;
  index index.html;
  location /api { proxy_pass http://127.0.0.1:5000; }
  location / { try_files $uri /index.html; }
}
```

Run Node as a service with `pm2` or systemd:

```bash
sudo npm i -g pm2
cd /srv/triveni/backend
pm2 start src/server.js --name triveni-api
pm2 save && pm2 startup
```

## Security checklist

- Change the `JWT_SECRET` in production.
- Change the default admin password immediately.
- Put nginx HTTPS (certbot) in front so login/API traffic is encrypted.
- Create an API client key in the API Keys page and use `x-api-key` for machine integrations.
- For high-volume deployments enable MySQL backup (mysqldump cron) daily.
- Only the API server needs outbound internet (for IRP/e-invoice calls); the DB should be local.

## GST portal integration

Out of the box e-Invoice runs in **sandbox mode**: GSTN 1.03 JSON + simulated IRN. For live filing:
1. Set `INTEGRATION_EINVOICE_URL` to your IRP provider endpoint (Wavez / Vayana / NSDL / ACE).
2. Add your provider token/credentials and map the response to update `einvoice_logs.irn` and `invoices.irn`.
3. E-way bills follow the same pattern via the GSTN e-Way Bill API or portal, using the generated JSON.

## Data locations

- DB: `triveni_gst_erp` (schema in `backend/src/db/schema.sql`, seed in `seed.js`).
- Exports: generated on demand (CSV / Tally XML) â€” no default file storage.
- IRN/JSON payloads are stored per invoice in `einvoice_logs.raw_request / signed_invoice`.