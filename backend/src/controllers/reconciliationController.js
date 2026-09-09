const { getPool } = require('../db');

/**
 * Import a GSTR-2B / purchase-register CSV and auto-match with our purchase bills.
 * Expected CSV columns (header row):
 *   gstin,supplier_name,invoice_no,invoice_date,taxable_value,gst_amount
 */
async function importReconciliation(req, res, next) {
  try {
    const { period, file_name, source } = req.body || {};
    if (!period) return res.status(400).json({ error: 'period is required (YYYY-MM).' });
    const rows = req.body.rows;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ error: 'rows[] is required.' });
    }
    const pool = getPool();
    const [imp] = await pool.query(
      `INSERT INTO reconciliation_imports (period,file_name,source,total_records) VALUES (?,?,?,?)`,
      [period, file_name || 'manual-test', source || 'MANUAL', rows.length]
    );
    const importId = imp.insertId;

    let matched = 0, mismatched = 0;
    for (const r of rows) {
      const supplierGstin = r.gstin || r.supplier_gstin || null;
      const invoiceNo = r.invoice_no || r.bill_no || null;
      const invoiceDate = r.invoice_date || r.bill_date || null;
      const taxable = Number(r.taxable_value || r.taxable || 0) || 0;
      const gst = Number(r.gst_amount || r.gst || 0) || 0;

      // Attempt match on our purchase_bills by supplier GSTIN + period
      let status = 'NOT_FOUND';
      let matchedBillId = null;
      let notes = null;
      if (supplierGstin) {
        const [pbs] = await pool.query(
          `SELECT pb.id, pb.grand_total, pb.tax_total FROM purchase_bills pb
           WHERE pb.vendor_gstin=? AND DATE_FORMAT(pb.bill_date,'%Y-%m')=? ORDER BY pb.bill_date DESC LIMIT 5`,
          [supplierGstin, period]
        );
        if (pbs.length) {
          for (const pb of pbs) {
            const supplierTotal = Number(taxable) + Number(gst);
            const diffVal = Math.abs(Number(pb.grand_total) - supplierTotal);
            if (diffVal < 0.5 || diffVal < Math.max(1, Number(pb.grand_total) * 0.001)) {
              status = 'MATCHED';
              matchedBillId = pb.id;
              notes = 'Auto-matched';
              matched++;
              break;
            }
          }
          if (status === 'NOT_FOUND') {
            status = 'MISMATCH';
            mismatched++;
            notes = 'Supplier found on this GSTIN but values differ';
          } else {
            // value matches; count correctly
          }
        }
      }
      // If supplier gstin unknown, check invoice no exact
      if (status === 'NOT_FOUND' && invoiceNo) {
        const [ex] = await pool.query(
          `SELECT pb.id, pb.grand_total FROM purchase_bills pb
           WHERE pb.bill_number=? OR (pb.notes LIKE ?) LIMIT 1`,
          [invoiceNo, `%${invoiceNo}%`]
        );
        if (ex.length) {
          status = Number(ex[0].grand_total) === taxable + gst ? 'MATCHED' : 'MISMATCH';
          matchedBillId = ex[0].id;
          if (status === 'MATCHED') matched++;
          else { mismatched++; notes = 'Bill no matched, values differ'; }
        }
      }
      if (status === 'NOT_FOUND') {
        mismatched++; // counts as unresolved
        notes = notes || 'No matching purchase bill in this period';
      }
      await pool.query(
        `INSERT INTO reconciliation_rows
         (import_id,supplier_gstin,supplier_name,invoice_no,invoice_date,taxable_value,gst_amount,status,matched_bill_id,notes)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [importId, supplierGstin, r.supplier_name || null, invoiceNo, invoiceDate || null, taxable, gst, status, matchedBillId, notes]
      );
    }

    await pool.query(
      'UPDATE reconciliation_imports SET matched=?, mismatched=? WHERE id=?',
      [matched, mismatched, importId]
    );
    res.status(201).json({ import_id: importId, total: rows.length, matched, mismatched });
  } catch (e) {
    next(e);
  }
}

async function listReconciliations(req, res, next) {
  try {
    const [rows] = await getPool().query('SELECT * FROM reconciliation_imports ORDER BY id DESC LIMIT 50');
    res.json(rows);
  } catch (e) {
    next(e);
  }
}

async function detailReconciliation(req, res, next) {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    const [imp] = await pool.query('SELECT * FROM reconciliation_imports WHERE id=?', [id]);
    if (!imp.length) return res.status(404).json({ error: 'Import not found.' });
    const [rows] = await pool.query('SELECT * FROM reconciliation_rows WHERE import_id=? ORDER BY id', [id]);
    const [summary] = await pool.query(
      `SELECT status, COUNT(*) AS n, IFNULL(SUM(taxable_value),0) AS taxable FROM reconciliation_rows
       WHERE import_id=? GROUP BY status`, [id]
    );
    res.json({ import: imp[0], rows, summary });
  } catch (e) {
    next(e);
  }
}

module.exports = { importReconciliation, listReconciliations, detailReconciliation };