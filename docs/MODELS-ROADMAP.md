# TriVista GST — Three-Business-Model Roadmap & Architecture

> Status: Draft v1 — for review. Companion to HOSTING.md.

## 1. Guiding principle

**One codebase, one database, one GST engine — three model "packs".**

Each market model is a *configuration + feature pack*, not a separate product. This
keeps the statutory GST engine (rate history, split GST, cess, e-invoice IRN, e-Way,
GSTR-1/2A, TDS/TCS, audit) identical across every customer — never divergent in an audit.

| Decision | Choice | Why |
|---|---|---|
| Repos | 1 monorepo (`backend` + `frontend`) | Single maintenance surface |
| Database | 1 schema, additive-only migrations | No dead branches, safe upgrades |
| Model switch | `company_settings.business_model` + license plan | Toggles menus/fields/reports per company |
| Compliance core | Never forked | One source of truth for tax math |
| Delivery | Feature flags + per-model baseline probes | Regression-safe per-model rollout |

## 2. Architecture

```
frontend (React)                    backend (Node/Express)
  Layout (nav by business_model)      /core        auth, company, ledger, GST, reports
  Model-1 pages (POS, Billing…)       /general     distribution, price lists, coupons, loyalty
  Model-3 pages (Production…)         /manufacturing  BOM, WIP, job work
  Model-2 pages (Trade…)              /import_export   multi-currency, exports, LUT
                                      licensing   plan → feature flags (exists)
                                      1 MySQL DB (additive migrations)
```

- `business_model` value: `general` | `manufacturing` | `import_export` (default `general`).
- Licensing maps each model to a **plan** using the existing `licensingController` (plan ↔
  model pack + add-ons). Feature flags gate routes, menu items, form fields, and reports.
- Model code is isolated in its own controllers/services/route files *inside the same
  app*; the shared core is only extended via additive changes.

## 3. Model packs

### Model 1 — General Business (Retail, Wholesale, Services, Agency, Distribution)
*Status today: ~90% covered by current build.*

| Area | Work |
|---|---|
| Distribution | Routes/beats, consignment (stock-out on challan), dealer credit & dues ageing |
| Agency | Commission (rate per party/product, computed per invoice, ledger-posted) |
| Pricing | Customer price lists + bulk price edits (retail/wholesale/distributor tiers exist) |
| Promotion | Coupons/promotional schemes (master + redemption engine + reports) |
| Loyalty | Points ledger, earn/burn rules, expiry, POS/Billing redemption |
| Outreach | WhatsApp/SMS/email receipts (needs provider + consent store) |

### Model 3 — Manufacturing
*New module family; reuses inventory + GST machinery.*

| Area | Work |
|---|---|
| Master data | BOM (Bill of Materials), work centres |
| Production | Work orders, issue RM → WIP → receive FG, scrap & by-products |
| Job work | Challans out/in, job-worker ledger, GSTR ITC positioning |
| Costing | Batch/standard costing, overhead absorption, variance |
| GST notes | Capital-goods ITC; valuation rules; compensation cess already handled |

### Model 2 — Import & Export
*Highest compliance weight; finance-table design changes.*

| Area | Work |
|---|---|
| Trade master | IEC, LUT, currency master, daily FX rates (RBI/FEEDS) |
| Invoicing | Multi-currency sales (FC amount, INR equivalent, FC ledger columns) |
| Document chain | PO → Packing List → Commercial Invoice → BL/AWB → Shipping Bill |
| GST/export | GSTR-1 Table 6A (shipping bill no./date), deemed exports, refund (RFD-01) flows |
| Finance | LC / advance-against-documents, EPCG/AA realization, FEMA-MIS |

## 4. Phased delivery

| Phase | Scope | Exit check |
|---|---|---|
| P0 (now) | Freeze shared core; add `business_model` + flags; wire licensing→pack | Toggle on/off changes menus only |
| P1 | Model 1 completion: price lists, coupons, loyalty, commission, consignment | Model-1 probe suite green on baseline |
| P2 | Model 3: BOM → work order → FG → job work → costing | Job-work + costing probes green |
| P3 | Model 2: master data → multi-currency → export docs → GSTR-1 6A | Export/FX probes green on baseline |
| P4 | Outreach (WhatsApp/SMS/email) — outside statutory core | — |

Each phase: backend `node --check` → frontend `npm run build` → restart → live probe →
baseline restore check → commit/push → robocopy to Drive. Statutory core is never
touched by pack work without its own probe.

## 5. Hard rules

1. Single GST engine — no per-model forking.
2. Additive-only DB migrations; schema.sql stays synced with live DB.
3. Model code isolated; core imported, never duplicated.
4. Every pack ships with its own live probe that restores the GAAP baseline exactly.
5. Trunk-based development, feature flags via licensing + `business_model`.

## 6. Open decisions for review

- Multi-currency ledger: store FC columns on `transactions` vs separate FC journals?
  (Recommend: FC snapshot columns + voucher-level FX rate on `invoices`/`transactions`.)
- Manufacturing scope: full MRP/planning vs production-only (BOM→FG)? (Recommend:
  production-only first; MRP later.)
- Consent storage for outreach (phone/email/WhatsApp) to be PA/consent-covered.