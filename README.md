# TriVista GST

*A Unit of TSA Enterprises*

A complete GST Billing and ERP system for Indian small and medium businesses, built on a Node.js + Express + MySQL API and a React (Vite) single-page frontend.

## Features

- **GST Billing** â€” taxable-value computation, automatic CGST/SGST (intra-state) or IGST (inter-state) split, gap-less pre-printed invoice numbering (atomic, no duplicates), discounts, payment modes with partial/cash entry, invoice cancellation with automatic stock reversal.
- **POS** â€” fast product-grid sale screen with walk-in customer support, live tax computation and receipt printing.
- **Inventory** â€” stock on hand computed from movements (IN / OUT / ADJUST), low-stock report, unit-cost valued stock report.
- **Masters** â€” products with HSN/SAC master lookup, categories, customers, vendors.
- **Accounting** â€” purchase bills with GST/ITC, P&L, balance sheet (inventory + receivables + payables), daybook.
- **GST Returns** â€” GSTR-1 (outward supplies) and GSTR-3B (rate-wise) summaries plus CSV export (Zoho/Busy-style) and Tally XML export.
- **e-Invoice / e-Way Bill** â€” GSTN 1.03 JSON payload generation, sandbox IRN simulation, e-way bill JSON preparation (connect to your IRP provider, e.g. Wavez / Vayana / NSDL, with your credentials).
- **GSTR-2B Reconciliation** â€” paste supplier rows, import, auto-match against purchase bills, mismatch / not-found tracking.
- **AI Assistant** â€” built-in rule-based insights and chat (monthly sales, growth, top product, slow movers, overdue), pluggable OpenAI / Gemini / Azure providers via Settings.
- **Public API** â€” API-key protected `GET /api/v1/products`, `/v1/invoices`, `/v1/stock`, `/v1/gst-summary`.
- **Multi-company / multi-branch ready** â€” users carry `company_id` / `branch_id` / `member_type`; schema supports branches table for later expansion.

## Stack

- Backend: Node.js, Express 4, mysql2, JWT auth, bcryptjs, helmet, cors, express-rate-limit
- Frontend: React 18, Vite 5, react-router-dom 6
- Database: MySQL 8 (tested with XAMPP MySQL)

## Project Structure

```
backend/
  src/
    server.js          # entry point (port 5000)
    db/schema.sql      # full schema
    db/init.js         # npm run db:init  (creates database + tables)
    db/seed.js         # npm run db:seed  (demo company, users, HSN master, products)
    middleware/        # auth JWT, API-key, error handler
    controllers/       # one per module
    routes/            # route maps
    utils/             # gst split/validation, invoice numbering, CSV + Tally XML exporters
frontend/
  src/
    pages/             # all screens
    components/Layout.jsx
    context/AuthContext.jsx
    api/client.js      # fetch wrapper with JWT
  vite.config.js       # port 5173, /api proxy -> localhost:5000
docs/HOSTING.md        # deployment guide
```

## Quick Start (Windows, MariaDB via XAMPP)

MariaDB ships with XAMPP and lives at `H:\xampp\mysql` (binaries + data dir). Config: `H:\xampp\mysql\bin\my.ini` (datadir `H:\xampp\mysql\data`, port 3306, root with no password).

1. Start database, API and frontend (or run the pieces separately):
   ```powershell
   powershell -ExecutionPolicy Bypass -File H:\TriveniGST\scripts\start-all.ps1
   ```
   - DB only: `scripts\start-db.ps1` · Stop DB: `scripts\stop-db.ps1`
   - Alternatively: `H:\xampp\mysql\bin\mysqld.exe --defaults-file=H:\xampp\mysql\bin\my.ini`

2. Backend:
   ```powershell
   cd backend
   npm install
   copy .env.example .env        # defaults already match: root / no password / triveni_gst_erp
   npm run db:init
   npm run db:seed               # only if starting from an empty database
   npm run dev                   # http://localhost:5000
   ```

3. Frontend:
   ```powershell
   cd frontend
   npm install
   npm run dev                   # http://localhost:5173
   ```

Open http://localhost:5173 and log in with:

| Email                 | Password   |
| --------------------- | ---------- |
| `admin@triveni.local` | `Admin@123` |

> Change the default password after first login.

## Env Variables (backend/.env)

| Variable      | Default              | Description                          |
| ------------- | -------------------- | ------------------------------------ |
| PORT          | 5000                 | API server port                      |
| DB_HOST       | localhost            | MySQL/MariaDB host                   |
| DB_PORT       | 3306                 | MySQL/MariaDB port                   |
| DB_USER       | root                 | MySQL user                           |
| DB_PASSWORD   | (empty)              | MySQL password                       |
| DB_NAME       | triveni_gst_erp      | Database name                        |
| JWT_SECRET    | (random)             | JWT signing secret â€” change in prod  |
| CORS_ORIGIN   | http://localhost:5173| Allowed frontend origin              |
| INTEGRATION_EINVOICE_URL | (empty)     | Real IRP endpoint when you have creds |

> The XAMPP MariaDB (port 3306, root with no password) matches these defaults â€” see Quick Start above. Data lives in `H:\xampp\mysql\data`.

## Key API Endpoints

```
POST /api/auth/login
GET  /api/products   POST /api/products
GET  /api/invoices   POST /api/invoices   GET /api/invoices/:id
POST /api/invoices/:id/pay   POST /api/invoices/:id/cancel
POST /api/pos/sale
GET  /api/reports/dashboard   /sales   /gstr1   /gstr3b
GET  /api/reports/export/csv   /export/xml
GET  /api/accounting/pnl   /balance-sheet   /daybook   /purchases
POST /api/accounting/purchases
POST /api/integration/einvoice/:id/generate  /simulate-irn
POST /api/integration/ewaybill/:id/generate
GET  /api/reconciliation   POST /api/reconciliation/import
GET  /api/ai/insights   POST /api/ai/chat   GET/PUT /api/ai/settings
GET  /api/apikeys/clients   POST /api/apikeys/clients
GET  /api/v1/products   /v1/invoices   /v1/stock   /v1/gst-summary   (x-api-key header)
```

## Invoicing Behaviour

- Numbering: `company_settings` keeps a counter; each invoice atomically increments it (`INV-0000001`). No gaps, no duplicates.
- GST: intra-state -> CGST + SGST split; inter-state -> IGST. Place of supply follows customer state vs. company state code (`company_settings.state_code`, default 29).
- Stock: goods lines auto-debit stock; cancelled invoices credit it back.
- Statuses: `PENDING`, `PARTIAL`, `PAID`, `CANCELLED`.

## e-Invoice / e-Way Bill

The system generates GSTN-1.03 JSON and runs a sandbox IRN simulation out of the box. For live filing set `INTEGRATION_EINVOICE_URL` to your IRP provider's endpoint and supply provider credentials/API tokens in the Integration screen notes. The e-Invoice flow is provider-agnostic (Wavez / Vayana / NSDL / ACE).

## License

Internal use. Contact the repository owner for reuse terms.