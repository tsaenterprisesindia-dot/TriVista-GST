/**
 * modelPacks.js — the three business-model "packs" (P0).
 *
 * One codebase, one GST engine; each market model is a configuration + feature
 * pack. This module is the single source of truth for:
 *   - the model ids / labels / descriptions,
 *   - the feature catalog (keys that gate menus, routes, fields, reports),
 *   - each model's base feature set.
 *
 * Feature resolution at runtime:
 *   effective[key] = modelBase[key]                  (does the model ship it?)
 *                otherwise planAddons[key]           (licensed add-on from plan.features)
 *                otherwise companyOverride[key]      (company_settings.feature_flags)
 *                otherwise catalogDefault[key]       (false unless an always-on core feature)
 */

const BUSINESS_MODELS = ['general', 'manufacturing', 'import_export'];

const MODEL_META = {
  general: {
    label: 'General Business',
    short: 'General',
    description: 'Retail, wholesale, services, agency & distribution (POS, billing, inventory, accounting).',
  },
  manufacturing: {
    label: 'Manufacturing',
    short: 'Manufacturing',
    description: 'Production: BOM, work orders, RM→WIP→FG, job work and costing (adds onto General).',
  },
  import_export: {
    label: 'Import & Export',
    short: 'Import/Export',
    description: 'Trade: IEC/LUT, multi-currency, export document chain and GSTR-1 6A (adds onto General).',
  },
};

/**
 * Feature catalog. `default` is the fallback for every model when the model's
 * base set does not mention the key. `group` is used by the Settings UI to
 * group toggles. Keys marked core:true are always available on every model.
 */
const FEATURE_CATALOG = [
  { key: 'pos', label: 'POS (Point of Sale)', group: 'Selling', core: true },
  { key: 'billing', label: 'Invoicing & Billing', group: 'Selling', core: true },
  { key: 'returns', label: 'Sales Returns & Refunds', group: 'Selling', core: true },
  { key: 'recurring', label: 'Recurring / Subscription Billing', group: 'Selling', core: true },
  { key: 'products', label: 'Products & Pricing', group: 'Inventory', core: true },
  { key: 'inventory', label: 'Inventory & Stock', group: 'Inventory', core: true },
  { key: 'customers', label: 'Customers', group: 'Parties', core: true },
  { key: 'vendors', label: 'Vendors & Purchase Bills', group: 'Parties', core: true },
  { key: 'accounting', label: 'Accounting & Ledger', group: 'Finance', core: true },
  { key: 'reconciliation', label: 'Bank Reconciliation', group: 'Finance', core: true },
  { key: 'gstReports', label: 'GST Reports & Returns', group: 'Compliance', core: true },
  { key: 'integration', label: 'e-Invoice / e-Way Bill', group: 'Compliance', core: true },
  { key: 'audit', label: 'Audit Log', group: 'Administration', core: true },
  { key: 'users', label: 'Users & Roles', group: 'Administration', core: true },
  { key: 'apiKeys', label: 'API Keys & Integrations', group: 'Administration', core: false },
  { key: 'assistant', label: 'AI Assistant', group: 'Productivity', core: false },
  { key: 'paymentLinks', label: 'Collect Payments (UPI links)', group: 'Selling', core: false },
  { key: 'licensing', label: 'Licensing & Sales', group: 'Administration', core: false },

  // Model 1 additions — General Business
  { key: 'distribution', label: 'Route / Beat Management', group: 'Distribution', core: false },
  { key: 'consignment', label: 'Consignment (stock-out on challan)', group: 'Distribution', core: false },
  { key: 'agency', label: 'Agency Commission', group: 'Sales', core: false },
  { key: 'priceLists', label: 'Customer Price Lists', group: 'Pricing', core: false },
  { key: 'coupons', label: 'Coupons & Promotional Schemes', group: 'Pricing', core: false },
  { key: 'loyalty', label: 'Loyalty Points', group: 'Pricing', core: false },
  { key: 'outreach', label: 'WhatsApp / SMS / Email Receipts', group: 'Productivity', core: false },

  // Model 3 additions — Manufacturing
  { key: 'bom', label: 'Bill of Materials (BOM)', group: 'Manufacturing', core: false },
  { key: 'workOrders', label: 'Work Orders & Production', group: 'Manufacturing', core: false },
  { key: 'jobWork', label: 'Job Work (challans & ledger)', group: 'Manufacturing', core: false },
  { key: 'costing', label: 'Standard / Batch Costing', group: 'Manufacturing', core: false },

  // Model 2 additions — Import & Export
  { key: 'tradeMasters', label: 'IEC / LUT / Currency Masters', group: 'Import & Export', core: false },
  { key: 'multiCurrency', label: 'Multi-Currency Invoicing', group: 'Import & Export', core: false },
  { key: 'exportDocs', label: 'Export Document Chain (PL→CI→BL/AWB→SB)', group: 'Import & Export', core: false },
  { key: 'exportGst', label: 'GSTR-1 Table 6A / Refund (RFD-01)', group: 'Import & Export', core: false },
];

const CATALOG = Object.fromEntries(FEATURE_CATALOG.map((f) => [f.key, f]));
const CATALOG_DEFAULT = (key) => (CATALOG[key] && CATALOG[key].core ? true : false);

/**
 * Base feature set per model. Every model starts from the core set; extra
 * features are enabled per pack. Manufacturing / Import-Export build ON TOP
 * of General (they keep the general surface and add their own modules).
 */
const MODEL_BASE_FEATURES = {
  general: Object.fromEntries(FEATURE_CATALOG.map((f) => [f.key, !!f.core && true])),
  manufacturing: {
    ...Object.fromEntries(FEATURE_CATALOG.map((f) => [f.key, !!f.core && true])),
    distribution: true,
    consignment: true,
    agency: true,
    priceLists: true,
    coupons: true,
    loyalty: true,
    bom: true,
    workOrders: true,
    jobWork: true,
    costing: true,
  },
  import_export: {
    ...Object.fromEntries(FEATURE_CATALOG.map((f) => [f.key, !!f.core && true])),
    distribution: true,
    consignment: true,
    agency: true,
    priceLists: true,
    tradeMasters: true,
    multiCurrency: true,
    exportDocs: true,
    exportGst: true,
  },
};

function modelInfo(model) {
  const m = MODEL_META[model] || MODEL_META.general;
  return { id: model, ...m };
}

/**
 * Resolve the effective feature map for a company.
 * mergeStrategy (default 'soft'): overrides/plan flags flip keys on or off;
 * core features can never be disabled by overrides (keeps the GST core safe).
 */
function resolveFeatures({ businessModel = 'general', planFeatures = null, overrides = null }) {
  const model = BUSINESS_MODELS.includes(businessModel) ? businessModel : 'general';
  const base = MODEL_BASE_FEATURES[model] || MODEL_BASE_FEATURES.general;
  const out = {};
  for (const f of FEATURE_CATALOG) {
    let v = base[f.key];
    if (planFeatures && typeof planFeatures[f.key] === 'boolean') v = planFeatures[f.key];
    if (overrides && typeof overrides[f.key] === 'boolean' && !f.core) v = overrides[f.key];
    out[f.key] = !!v;
  }
  return out;
}

module.exports = {
  BUSINESS_MODELS,
  MODEL_META,
  FEATURE_CATALOG,
  CATALOG,
  CATALOG_DEFAULT,
  MODEL_BASE_FEATURES,
  modelInfo,
  resolveFeatures,
};