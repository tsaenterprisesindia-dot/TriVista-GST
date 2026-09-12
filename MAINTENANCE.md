# TriVista GST ERP - Maintenance & Update Guide

How to keep this project healthy, updated and recoverable. Follow the order of
sections below - especially the "Change workflow", which is the same safe path
every upgrade should take.

---

## 1. Environment at a glance

| Item | Where |
| --- | --- |
| Backend (Node/Express) | `I:\TriveniGST\backend` - runs on port **5000** |
| Frontend (React/Vite) | `I:\TriveniGST\frontend` - dev server on **5173**; production build served by the backend |
| Database | MariaDB (XAMPP) `H:\xampp\mysql` - database `triveni_gst_erp`, port 3306 |
| One-click start | `start.bat` (starts DB if down, then backend) |
| Backend logs | `%TEMP%\opencode\prod_out.log` (stdout), `prod_err.log` (errors) |
| Git remote | `https://github.com/tsaenterprisesindia-dot/TriVista-GST` (private, `main`) |
| Drive mirror | `J:\My Drive\TriVista-GST` (robocopy) |

Schema source of truth: `backend/src/db/schema.sql` (base schema + seed).
Migrations: `backend/scripts/mig-*.js` (deltas applied on top of schema.sql).

---

## 2. Golden rules

1. **Backup before every change** - a dump is the difference between a 5-minute
   restore and a lost week (this project already survived a `users` table crash
   because a dump existed).
2. **Never alter the live database by hand.** All schema/data changes go through
   idempotent migrations, applied via `mig-all.js`, or are one-off scripts you
   keep in `backend/scripts/`.
3. **Keep `schema.sql` and migrations in lock-step.** If a migration changes a
   table, update the matching `CREATE TABLE` in schema.sql too, so a fresh
   install (schema.sql + `mig-all.js`) and an upgraded install produce identical
   schemas.
4. **Never commit secrets.** `.env`, `.env.*`, `*.log`, backups and `node_modules`
   stay out of git (gitignore). `JWT_SECRET`, `CRYPTO_SECRET`, DB credentials and
   AI/IRP API keys live in `.env` only.
5. **Test before you call it done.** Rebuild the frontend, restart, and smoke-test
   the touched flows against `http://localhost:5000`.

---

## 3. Routine - what to do and when

### Daily / weekly
- Take a backup (Settings - Backups, or the automatic `mysqldump` job).
- Glance at the **Audit Log** for unexpected activity.
- Scan the **notification bell** (overdue receivables, unpaid vendor bills,
  low stock, licence renewals).
- Reconcile bank statements (Reconciliation) when new statements arrive.

### Monthly (after GST filing)
- Export **GSTR-1 / GSTR-3B** from GST Reports and file.
- Run **Month Review** and **Accounting - Profit & Loss**; check collections.
- Verify UPI/credit collections reconciled; chase top overdue invoices.
- Clean up test/dummy records.
- Review licensing renewals (if reselling) before they lapse.

### Quarterly
- Run `npm audit` in `backend` and `frontend`; apply non-breaking updates.
- Rebuild + restart + smoke-test after any dependency update.
- Restore a backup into a scratch DB and run `CHECK TABLE` on all 23 tables to
  confirm integrity.

---

## 4. Change workflow (every update)

```
1. BACKUP        -> Settings - Backups (download to Drive) or mysqldump
2. WRITE MIGRATION (only if schema/data changes):
     add backend/scripts/mig-<feature>.js, idempotent, prints "MIG OK"
     register it in the ORDER array of backend/scripts/mig-all.js
     update the matching CREATE TABLE in backend/src/db/schema.sql
3. CODE          -> backend/src/controllers|routes, frontend/src/pages|components
                    (follow existing patterns; no inline comments)
4. APPLY         -> cd backend && node scripts/mig-all.js     (runs only new ones)
5. BUILD/TEST    -> cd frontend && npm run build
                    restart via start.bat, watch %TEMP%\opencode\prod_err.log
                    smoke-test the changed flows on http://localhost:5000
6. SHIP          -> git add <files>; git commit; git push origin main
                    then Drive-sync: robocopy (see start helper / prior syncs)
```

### Migrations runner
`node backend/scripts/mig-all.js` applies every `mig-*.js` file exactly once; each
successful run is recorded (name + sha256) in the `schema_migrations` table. This
prevents duplicate seeds/columns if a script is run twice - the classic failure
when a migration re-parses `schema.sql` or re-seeds lookups.

- Baseline an already-migrated database without re-running anything:
  `node backend/scripts/mig-all.js --mark-all-applied`
- A fresh install never needs the baseline flag: it just runs all migrations.

Existing migrations (order as defined in mig-all.js):

| Migration | Purpose |
| --- | --- |
| `mig-vendor-company-name.js` | `vendors.company_name` column |
| `mig-upi-payment-links.js` | `company_settings.upi_id/upi_beneficiary` + `payment_links` |
| `mig-licensing.js` | licensing tables + `license_plans` seed |
| `mig-licensing-invoice.js` | `client_licenses.invoice_id` |
| `mig-terms-acceptance.js` | `users.accepted_terms_at` (T&C gate) |
| `mig-06-ledger.js` | Double-entry general ledger: `journal_entries` table, `transactions.journal_id/voucher_no`, `payments.bill_id`, input-GST + round-off accounts, balanced backfill of existing invoices/payments/purchase bills |
| `mig-07-business-master.js` | Business/Enterprise Master: `company_settings.legal_name/trade_name/constitution`; backfills legal_name from company_name |
| `mig-08-branches.js` | Unit/Branch Management: `branches.invoice_start_number`, `company_settings.active_branch_id`, `invoice_series.branch_id` (per-branch series keyed `branch_id+fy+type`), re-homes existing series to the head office |

### Unit / Branch Management
Units/branches are managed under Settings - Units / Branches (`/api/branches`). Each unit can carry
its own name, GSTIN (blank = not separately registered), address, state/state-code and billing series
(prefix + start number). The **active unit** is stored as `company_settings.active_branch_id`; switching
units copies the unit's printable profile into `company_settings` (name, GSTIN, PAN, address, state,
prefix) so every screen that reads the company profile - invoices, POS, e-Invoice seller details, receipts -
and the per-branch invoice numbering follow the active unit. Invoice numbering is gap-less per
`(branch_id, fy)` (`invoice_series` PK). Institutional guards: the head office and the last active unit
cannot be removed, nor can the currently active unit be deactivated while active.

### Double-entry ledger module
Accounting now maintains a real, balanced general ledger (vouchers in
`journal_entries`, legs in `transactions`). Every invoice, sale payment, purchase
bill and purchase payment is automatically posted; cancelling an invoice posts
mirror (reversal) vouchers. Manual journal vouchers are supported.

- Endpoints: `GET/POST/PUT/DELETE /api/accounts`, `GET /api/accounts/ledger`,
  `GET /api/accounts/trial-balance`, `GET /api/accounts/cash-bank`,
  `GET/POST/DELETE /api/accounts/journal`.
- **Profit & Loss** and **Balance Sheet** read the ledger and fall back to the old
  document-based numbers only when nothing has been posted yet.
- Vouchers are idempotent (unique `voucher_no`) - re-running a backfill or a
  migration never double-posts.
- Posting convention: `ASSET/EXPENSE` debit-positive, `LIABILITY/INCOME/EQUITY`
  credit-positive. Round-off adjustments land on account `5600 Round Off`.
- The **Chart of Accounts** is managed under Accounting - Chart of Accounts.
  Opening balances are locked once an account has ledger postings.

---

## 5. Backups, restore & disaster recovery

- **In-app backup**: Settings - Backups creates an encrypted snapshot you can
  download; keep one copy off-machine (Drive/network share). Restore returns the
  system to that snapshot. **Clear Data** is destructive - only ever run it right
  after making a fresh backup.
- **mysqldump job** (recommended): daily scheduled task, e.g.
  `H:\xampp\mysql\bin\mysqldump -u root triveni_gst_erp > D:\backups\erp_YYYY-MM-DD.sql`,
  pruning older than ~14 days.
- **If the DB was rebuilt from an old schema** (this happened once): do not throw
  data away. Apply `schema.sql` then run `mig-all.js`, then diff the live schema
  against schema.sql to find every gap (missing tables/columns) before resuming use.
- **If MariaDB crashes on a table** (the `users` crash precedent): the recovery
  path that worked was `innodb_force_recovery=6` in `my.ini` -> `mysqldump` that
  table -> revert my.ini to normal -> drop table -> restore from dump -> `CHECK TABLE`.
  Keep that dump as a cold copy on Drive.

### Restarting services
- Backend down? Run `start.bat` (idempotent - safe when already running).
- Database down? `start.bat` opens XAMPP control and waits for MySQL; or start
  MySQL manually from the XAMPP control panel.
- Frontend dev (optional, hot-reload for development only): `cd frontend && npm run dev`.

---

## 6. Security notes

- Only **SUPER_ADMIN** can manage users/settings/audit/API keys/licensing.
  `SUPER_ADMIN` accounts cannot be created via the API (operator/DB only) and the
  last SUPER_ADMIN can never be demoted, deactivated or deleted.
- Users are forced to accept the **Terms of Service** before using the app; login
  IDs/passwords of users are never exposed to other users.
- Credentials (AI provider keys, IRP/e-Way, public API secrets) are stored
  encrypted (`enc:` prefix, AES-256). Do not paste them into code, commits or chats.
- Review the **Audit Log** regularly; revoke leaked public API keys immediately.
- Before any internet exposure, put the app behind **HTTPS** (reverse proxy such as
  Caddy/nginx, or an authenticated tunnel). Do not expose raw HTTP on port 5000.

---

## 7. Known quirks

- Migrations hardcode the local DB defaults (root / empty password /
  `triveni_gst_erp`) consistent with the XAMPP install; they respect
  `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` env overrides when set.
- `mig-licensing.js` re-parses `schema.sql` table blocks - safe now that it is
  recorded as applied, but never delete its `schema_migrations` row and re-run it.
- Unknown routes currently return HTTP 500 (pre-existing 404-handler behaviour).