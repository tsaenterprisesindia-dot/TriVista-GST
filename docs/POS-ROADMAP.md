# TriVista GST — POS Roadmap

> Final recommendation — build the POS in three stages. Status reflects current build.

## Stage 1 — Fast billing core (STATUS: MOSTLY BUILT)

| Feature | Status | Notes |
|---|---|---|
| Fast billing / POS sale | ✅ `POST /api/pos/sale` | single-screen sale flow |
| Barcode scanning | 🟡 partial | scan/search by scan code; needs USB/barcode UI polish + duplicate-item merge |
| Payments (cash/UPI/card) | ✅ | payment methods + split payment |
| GST invoice (GSTR-ready) | ✅ | rate + split + cess on `invoices`/`transactions` |
| Stock deduction | ✅ | `stock_movements` on sale |
| Returns / refunds | ✅ | credit notes, stock reversal, refund to original payment |
| Daily reports | 🟡 partial | sale reports exist; add consolidated daily POS summary + DS/DR |

## Stage 2 — Back-office (STATUS: MOSTLY BUILT)

| Feature | Status | Notes |
|---|---|---|
| Purchases (bills/vendors) | ✅ | `purchase_bills` + vendor ledger |
| Inventory | ✅ | stock, movements, batches/serial |
| Ledgers (accounting/accounts) | ✅ | double-entry ledger + account heads |
| Multi-branch | ✅ | `/branches` + branch on invoices/stock |
| Customer credit | ✅ | balance-to-pay/credit on sale; credit-limit alert |
| GST reconciliation | ✅ | `/reconciliation` (GSTR-2A/2B match) + e-invoice/e-way |
| Audit trail | ✅ | `/audit` + users/roles |

## Stage 3 — Offline & intelligence (STATUS: NOT STARTED)

| Feature | Notes |
|---|---|
| Offline POS | local-first (PouchDB/IndexedDB) with sync-on-reconnect; queue + conflict rules |
| Advanced analytics | sales/stock/profit dashboards, cohort & margin drill-down |
| Loyalty points | earn/burn ledger, expiry, POS redemption — gated by `loyalty` feature flag |
| Integrations | e-invoice/e-way exist; add bank feeds, WhatsApp/SMS receipts |
| AI assistance | `/assistant` exists as chat; add agent-driven support (returns/dunning) |

## Exit checks

- Stage 1: POS live sale → GST invoice → stock out → return/refund → daily DS/DR green on baseline.
- Stage 2: purchase → stock-in → sale → ledger → reconciliation → audit probe green.
- Stage 3: offline queue flush probe + loyalty/analytics probes green.