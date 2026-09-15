const { getPool } = require('../db');
const {
  BUSINESS_MODELS,
  MODEL_META,
  FEATURE_CATALOG,
  MODEL_BASE_FEATURES,
  modelInfo,
  resolveFeatures,
} = require('../config/modelPacks');

/**
 * GET /api/model/packs
 * Static catalog of the three business-model packs + full feature catalog.
 * Used by Settings/UI to render model selection and feature toggles.
 */
async function getPacks(_req, res, next) {
  try {
    res.json({
      models: BUSINESS_MODELS.map((m) => ({
        id: m,
        label: MODEL_META[m].label,
        short: MODEL_META[m].short,
        description: MODEL_META[m].description,
        base_features: MODEL_BASE_FEATURES[m] || {},
      })),
      features: FEATURE_CATALOG,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/model/features
 * Effective per-company feature flags for the authenticated company.
 * Resolution: model base -> active plan add-ons -> company overrides (core safe).
 */
async function getFeatures(req, res, next) {
  try {
    const [[company]] = await getPool().query(
      'SELECT business_model, feature_flags FROM company_settings ORDER BY id LIMIT 1'
    );
    const businessModel = (company && company.business_model) || 'general';
    // Active plan add-ons: join through client_licenses to the highest-priority
    // active license, if any (plan->pack wiring). No license = no add-ons.
    let planFeatures = null;
    const [[lic]] = await getPool().query(
      `SELECT p.features FROM client_licenses cl
       JOIN license_plans p ON p.id = cl.plan_id
       WHERE cl.status IN ('TRIAL','ACTIVE') AND cl.expiry_date >= CURDATE()
       ORDER BY CASE cl.status WHEN 'ACTIVE' THEN 0 WHEN 'TRIAL' THEN 1 ELSE 2 END, cl.id DESC
       LIMIT 1`
    );
    if (lic && lic.features) {
      try {
        const parsed = typeof lic.features === 'string' ? JSON.parse(lic.features) : lic.features;
        if (parsed && typeof parsed === 'object') planFeatures = parsed;
      } catch (_e) { /* malformed plan features -> ignore */ }
    }
    let overrides = null;
    if (company && company.feature_flags) {
      try {
        const parsed = typeof company.feature_flags === 'string' ? JSON.parse(company.feature_flags) : company.feature_flags;
        if (parsed && typeof parsed === 'object') overrides = parsed;
      } catch (_e) { /* malformed feature_flags -> ignore */ }
    }
    const features = resolveFeatures({ businessModel, planFeatures, overrides });
    res.json({
      business_model: businessModel,
      model: modelInfo(businessModel),
      features,
      overrides: overrides || {},
      plan_features: planFeatures,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * PUT /api/model/features
 * Save company feature overrides (company_settings.feature_flags).
 * Merges into existing overrides; core features are protected and can never
 * be disabled via overrides.
 */
async function updateFeatures(req, res, next) {
  try {
    const f = (req.body && req.body.feature_flags) || {};
    if (typeof f !== 'object' || Array.isArray(f)) {
      return res.status(400).json({ error: 'feature_flags must be an object of feature -> boolean.' });
    }
    const known = new Set(FEATURE_CATALOG.map((x) => x.key));
    const pool = getPool();
    const [rows] = await pool.query('SELECT id, feature_flags FROM company_settings ORDER BY id LIMIT 1');
    if (!rows.length) {
      return res.status(404).json({ error: 'Company settings not found.' });
    }
    // Merge into existing overrides (preserves toggles set by other saves).
    let merged = {};
    if (rows[0].feature_flags) {
      try {
        const parsed = typeof rows[0].feature_flags === 'string' ? JSON.parse(rows[0].feature_flags) : rows[0].feature_flags;
        if (parsed && typeof parsed === 'object') merged = { ...parsed };
      } catch (_e) { /* malformed -> start fresh */ }
    }
    for (const [k, v] of Object.entries(f)) {
      if (!known.has(k)) continue;
      const isCore = FEATURE_CATALOG.find((x) => x.key === k)?.core === true;
      if (isCore) continue; // core features are never disabled by override
      merged[k] = !!v;
    }
    await pool.query('UPDATE company_settings SET feature_flags=? WHERE id=?', [JSON.stringify(merged), rows[0].id]);
    res.json({ ok: true, feature_flags: merged });
  } catch (e) {
    next(e);
  }
}

module.exports = { getPacks, getFeatures, updateFeatures };