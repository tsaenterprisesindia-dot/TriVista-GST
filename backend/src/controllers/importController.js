const { getPool } = require('../db');
const { isValidGstin } = require('../utils/gst');
const { pad } = require('../utils/helpers');
const { applyRateChange } = require('../utils/rateHistory');
const { audit } = require('../utils/audit');

async function bulk(req, res, next) {
  const kind = String(req.body?.kind || '');
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!['customers', 'vendors', 'products', 'hsn'].includes(kind)) {
    return res.status(400).json({ error: 'Supported kinds: customers, vendors, products, hsn.' });
  }
  if (!rows.length) return res.status(400).json({ error: 'No rows to import.' });
  const pool = getPool();
  const imported = [];
  const failed = [];
  try {
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx] || {};
      const norm = {};
      for (const [k, v] of Object.entries(row)) norm[String(k).toLowerCase().trim()] = v;
      const r = { ...row, ...norm };
      try {
        let id;
        if (kind === 'customers') {
          const name = String(r.name || r.company_name || '').trim();
          if (!name) throw new Error('name is required.');
          const legal_name = String(r.legal_name || r.name || '').trim();
          if (!legal_name) throw new Error('legal_name is required.');
          const gstin = String(r.gstin || '').trim() || null;
          if (gstin && !isValidGstin(gstin)) throw new Error(`Invalid GSTIN "${r.gstin}".`);
          const [mx] = await pool.query('SELECT COALESCE(MAX(id),0) AS mx FROM customers');
          const code = `CUST-${pad((mx[0].mx || 0) + 1, 4)}`;
          const [ins] = await pool.query(
            `INSERT INTO customers
             (customer_code,name,legal_name,company_name,gstin,pan,phone,email,address_line1,address_line2,city,state,state_code,pincode,opening_balance,credit_limit,is_active,created_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              code, name, legal_name, r.trade_name || r.company_name || null, gstin, r.pan || null, r.phone || null, r.email || null,
              r.address_line1 || null, r.address_line2 || null, r.city || null, r.state || null,
              r.state_code || null, r.pincode || null, Number(r.opening_balance) || 0, r.credit_limit || null,
              r.is_active === undefined ? 1 : r.is_active ? 1 : 0, req.user.id,
            ]
          );
          id = ins.insertId;
        } else if (kind === 'vendors') {
          const name = String(r.name || r.company_name || '').trim();
          if (!name) throw new Error('name is required.');
          const legal_name = String(r.legal_name || r.name || '').trim();
          if (!legal_name) throw new Error('legal_name is required.');
          const gstin = String(r.gstin || '').trim() || null;
          if (gstin && !isValidGstin(gstin)) throw new Error(`Invalid GSTIN "${r.gstin}".`);
          const [mx] = await pool.query('SELECT COALESCE(MAX(id),0) AS mx FROM vendors');
          const code = `VEND-${pad((mx[0].mx || 0) + 1, 4)}`;
          const [ins] = await pool.query(
            `INSERT INTO vendors
             (vendor_code,name,legal_name,company_name,gstin,pan,phone,email,address_line1,city,state,state_code,pincode,opening_balance)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [code, name, legal_name, r.trade_name || r.company_name || null, gstin, r.pan || null, r.phone || null, r.email || null,
             r.address_line1 || null, r.city || null, r.state || null, r.state_code || null, r.pincode || null,
             Number(r.opening_balance) || 0]
          );
          id = ins.insertId;
        } else if (kind === 'products') {
          const name = String(r.name || '').trim();
          if (!name) throw new Error('name is required.');
          const hsnCode = String(r.hsn_code || r.hsn || '').trim();
          if (!hsnCode) throw new Error('hsn_code is required.');
          const gstRate = Number(r.gst_rate) || 0;
          let hsnId = null;
          const [h] = await pool.query('SELECT id FROM hsn_sac_codes WHERE code=?', [hsnCode]);
          if (h.length) hsnId = h[0].id;
          else {
            const [hs] = await pool.query(
              `INSERT INTO hsn_sac_codes (code,description,type,gst_rate,cgst_rate,sgst_rate,igst_rate,cess_rate)
               VALUES (?,?,'HSN',?,?,?,?,?)`,
              [hsnCode, r.description || name, gstRate, gstRate / 2, gstRate / 2, gstRate, Number(r.cess_rate) || 0]
            );
            hsnId = hs.insertId;
          }
          let categoryId = null;
          const catName = String(r.category_name || r.category || '').trim();
          if (catName) {
            const [cat] = await pool.query('SELECT id FROM categories WHERE name=?', [catName]);
            if (cat.length) categoryId = cat[0].id;
            else {
              const [ci] = await pool.query('INSERT INTO categories (name) VALUES (?)', [catName]);
              categoryId = ci.insertId;
            }
          }
          const [ins] = await pool.query(
            `INSERT INTO products
             (sku,barcode,name,description,category_id,hsn_id,hsn_code,gst_rate,cess_rate,unit,
              selling_price,wholesale_price,purchase_price,mrp,min_stock,weight_kg,is_service,is_active)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              r.sku || null, r.barcode || null, name, r.description || null, categoryId, hsnId,
              hsnCode, gstRate, r.cess_rate === undefined ? null : Number(r.cess_rate) || 0, String(r.unit || 'PCS').toUpperCase().slice(0, 5),
              Number(r.selling_price) || 0, r.wholesale_price || null, Number(r.purchase_price) || 0, r.mrp || null,
              r.min_stock || null, r.weight_kg || null, r.is_service ? 1 : 0,
              r.is_active === undefined ? 1 : r.is_active ? 1 : 0,
            ]
          );
          id = ins.insertId;
          const opening = Number(r.opening_stock) || 0;
          if (opening > 0 && !r.is_service) {
            await pool.query(
              `INSERT INTO stock_movements (product_id,type,quantity,unit_cost,note,created_by)
               VALUES (?,'IN',?,?,'Opening stock (CSV import)',?)`,
              [id, opening, Number(r.purchase_price) || 0, req.user.id]
            );
          }
        } else if (kind === 'hsn') {
          const code = String(r.code || r.hsn_code || '').trim();
          if (!code) throw new Error('code is required.');
          const rate = Number(r.gst_rate) || 0;
          const [dup] = await pool.query('SELECT id, gst_rate, description FROM hsn_sac_codes WHERE code=?', [code]);
          let hsnId;
          if (dup.length) {
            const rateChanged = Math.abs(Number(dup[0].gst_rate) - rate) > 0.001;
            // A rate change via import is also an effective-dated change.
            if (rateChanged) {
              await applyRateChange(pool, {
                code,
                effectiveFrom: new Date().toISOString().slice(0, 10),
                gstRate: rate,
                cessRate: r.cess_rate === undefined ? undefined : Number(r.cess_rate) || 0,
                source: 'CSV import',
                notes: dup[0].description || null,
                createdBy: req.user.id,
              });
            }
            await pool.query(
              `UPDATE hsn_sac_codes SET description=COALESCE(?,description), type=COALESCE(?,type),
                gst_rate=?, cgst_rate=?, sgst_rate=?, igst_rate=?, cess_rate=COALESCE(?,cess_rate) WHERE id=?`,
              [r.description || null, r.type || null, rate, rate / 2, rate / 2, rate,
               r.cess_rate === undefined ? null : Number(r.cess_rate) || 0, dup[0].id]
            );
            hsnId = dup[0].id;
          } else {
            const [ins] = await pool.query(
              `INSERT INTO hsn_sac_codes (code,description,type,gst_rate,cgst_rate,sgst_rate,igst_rate,cess_rate)
               VALUES (?,?,?,?,?,?,?,?)`,
              [code, r.description || null, r.type || 'HSN', rate, rate / 2, rate / 2, rate,
               r.cess_rate === undefined ? 0 : Number(r.cess_rate) || 0]
            );
            hsnId = ins.insertId;
          }
          id = hsnId;
        }
        imported.push({ row: idx + 1, id });
      } catch (err) {
        failed.push({ row: idx + 1, error: String(err.message || err) });
      }
    }
    await audit(req, 'IMPORT', kind, null, { rows: rows.length, imported: imported.length, failed: failed.length });
    res.status(failed.length ? 207 : 201).json({
      kind,
      total: rows.length,
      imported: imported.length,
      failed,
    });
  } catch (e) {
    next(e);
  }
}

module.exports = { bulk };