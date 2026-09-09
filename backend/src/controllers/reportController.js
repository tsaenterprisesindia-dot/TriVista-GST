const { getPool, query } = require('../db');
const { invoicesCsv, ledgerCsv, tallyXml } = require('../utils/exporters');

/**
 * Dashboard summary.
 */
async function dashboard(req, res, next) {
  try {
    const pool = getPool();
    const t = new Date().toISOString().slice(0, 10);

    const [salesToday] = await pool.query(
      `SELECT IFNULL(SUM(grand_total),0) AS total, COUNT(*) AS count FROM invoices
       WHERE invoice_date=? AND status NOT IN ('CANCELLED')`, [t]
    );
    const [monthSales] = await pool.query(
      `SELECT IFNULL(SUM(grand_total),0) AS total, COUNT(*) AS count FROM invoices
       WHERE DATE_FORMAT(invoice_date,'%Y-%m') = DATE_FORMAT(CURDATE(),'%Y-%m')
         AND status NOT IN ('CANCELLED')`
    );
    const [gstCollected] = await pool.query(
      `SELECT IFNULL(SUM(igst_total)+SUM(cgst_total)+SUM(sgst_total)+SUM(cess_total),0) AS total
       FROM invoices WHERE status NOT IN ('CANCELLED')`
    );
    const [receivables] = await pool.query(
      `SELECT IFNULL(SUM(balance_due),0) AS total, COUNT(*) AS count
       FROM invoices WHERE status IN ('PENDING','PARTIAL')`
    );
    const [stockVal] = await pool.query(
      `SELECT IFNULL(SUM(qty*p.purchase_price),0) AS value FROM
       (SELECT sm.product_id, SUM(CASE WHEN sm.type='IN' THEN sm.quantity WHEN sm.type='OUT' THEN -sm.quantity ELSE sm.quantity END) AS qty
        FROM stock_movements sm GROUP BY sm.product_id HAVING qty>0) q
       JOIN products p ON p.id=q.product_id`
    );
    const [lowStock] = await pool.query(
      `SELECT p.name, q.qty AS on_hand, p.min_stock FROM
       (SELECT sm.product_id, SUM(CASE WHEN sm.type='IN' THEN sm.quantity WHEN sm.type='OUT' THEN -sm.quantity ELSE sm.quantity END) AS qty
        FROM stock_movements sm GROUP BY sm.product_id) q
       JOIN products p ON p.id=q.product_id
       WHERE q.qty <= p.min_stock ORDER BY q.qty ASC LIMIT 8`
    );
    const [recent] = await pool.query(
      `SELECT i.invoice_number,i.invoice_date,i.customer_name,i.grand_total,i.status,
              (SELECT COUNT(*) FROM invoice_items ii WHERE ii.invoice_id=i.id) AS item_count
       FROM invoices i ORDER BY i.id DESC LIMIT 8`
    );
    const [topCustomers] = await pool.query(
      `SELECT customer_name, SUM(grand_total) AS total, COUNT(*) AS invoices
       FROM invoices WHERE status NOT IN ('CANCELLED')
       GROUP BY customer_name ORDER BY total DESC LIMIT 5`
    );

    res.json({
      salesToday: salesToday[0].total,
      salesTodayCount: salesToday[0].count,
      monthSales: monthSales[0].total,
      monthSalesCount: monthSales[0].count,
      gstCollected: gstCollected[0].total,
      receivables: receivables[0].total,
      receivablesCount: receivables[0].count,
      stockValue: stockVal[0].value,
      lowStock,
      recentInvoices: recent,
      topCustomers,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * Sales & GST report by date range.
 */
async function salesReport(req, res, next) {
  try {
    const { from, to } = req.query;
    const pool = getPool();
    const where = [];
    const params = [];
    if (from) where.push('invoice_date >= ?'), params.push(from);
    if (to) where.push('invoice_date <= ?'), params.push(to);
    where.push(`status NOT IN ('CANCELLED')`);
    const whereSql = 'WHERE ' + where.join(' AND ');

    const [summary] = await pool.query(
      `SELECT COUNT(*) AS invoice_count,
              IFNULL(SUM(subtotal),0) AS taxable_value,
              IFNULL(SUM(discount),0) AS discounts,
              IFNULL(SUM(cgst_total),0) AS cgst,
              IFNULL(SUM(sgst_total),0) AS sgst,
              IFNULL(SUM(igst_total),0) AS igst,
              IFNULL(SUM(cess_total),0) AS cess,
              IFNULL(SUM(tax_total),0) AS tax,
              IFNULL(SUM(grand_total),0) AS grand_total
       FROM invoices ${whereSql}`, params
    );
    const [byDay] = await pool.query(
      `SELECT invoice_date, COUNT(*) AS invoices, IFNULL(SUM(grand_total),0) AS total
       FROM invoices ${whereSql} GROUP BY invoice_date ORDER BY invoice_date`, params
    );
    const [byType] = await pool.query(
      `SELECT invoice_type, is_interstate, COUNT(*) AS invoices, IFNULL(SUM(grand_total),0) AS total,
              IFNULL(SUM(tax_total),0) AS tax
       FROM invoices ${whereSql} GROUP BY invoice_type, is_interstate`, params
    );
    res.json({ summary: summary[0], byDay, byType });
  } catch (e) {
    next(e);
  }
}

/**
 * GSTR-1 style outward supplies summary per HSN/rate for a period.
 */
async function gstr1(req, res, next) {
  try {
    const { from, to } = req.query;
    const pool = getPool();
    const params = [from, to];
    const [rows] = await pool.query(
      `SELECT i.invoice_number, i.invoice_date, i.is_interstate,
              ii.hsn_code, ii.gst_rate,
              SUM(ii.quantity) AS quantity,
              SUM(ii.taxable_value) AS taxable_value,
              SUM(ii.cgst_amount) AS cgst,
              SUM(ii.sgst_amount) AS sgst,
              SUM(ii.igst_amount) AS igst,
              SUM(ii.cess_amount) AS cess,
              i.customer_name, i.customer_gstin
       FROM invoice_items ii
       JOIN invoices i ON i.id=ii.invoice_id
       WHERE i.invoice_date BETWEEN ? AND ? AND i.status NOT IN ('CANCELLED')
       GROUP BY i.invoice_number, i.invoice_date, i.is_interstate, ii.hsn_code, ii.gst_rate,
                i.customer_name, i.customer_gstin
       ORDER BY i.invoice_date`, params
    );
    // aggregate totals
    const taxTotals = { cgst: 0, sgst: 0, igst: 0, cess: 0, taxable: 0 };
    for (const r of rows) {
      taxTotals.cgst += Number(r.cgst) || 0;
      taxTotals.sgst += Number(r.sgst) || 0;
      taxTotals.igst += Number(r.igst) || 0;
      taxTotals.cess += Number(r.cess) || 0;
      taxTotals.taxable += Number(r.taxable_value) || 0;
    }
    res.json({ data: rows, totals: taxTotals });
  } catch (e) {
    next(e);
  }
}

/**
 * GSTR-3B style summary by rate slab.
 */
async function gstr3b(req, res, next) {
  try {
    const { from, to } = req.query;
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT ii.gst_rate,
              SUM(ii.taxable_value) AS taxable_value,
              SUM(ii.cgst_amount) AS cgst,
              SUM(ii.sgst_amount) AS sgst,
              SUM(ii.igst_amount) AS igst,
              SUM(ii.cess_amount) AS cess
       FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
       WHERE i.invoice_date BETWEEN ? AND ? AND i.status NOT IN ('CANCELLED')
       GROUP BY ii.gst_rate ORDER BY ii.gst_rate`, [from, to]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
}

/**
 * Export invoices to CSV (Zoho / Busy / Excel).
 */
async function exportCsv(req, res, next) {
  try {
    const { from, to, customer_id } = req.query;
    const pool = getPool();
    const where = ['i.status NOT IN (?)'];
    const params = [];
    if (from) where.push('i.invoice_date >= ?'), params.push(from);
    if (to) where.push('i.invoice_date <= ?'), params.push(to);
    if (customer_id) where.push('i.customer_id = ?'), params.push(customer_id);
    params.unshift('CANCELLED');
    const q = `SELECT i.* FROM invoices i WHERE ${where.join(' AND ')} ORDER BY i.invoice_date`;
    const [invoices] = await pool.query(q, params);
    // ID subquery with the same conditions but an explicit alias (i2)
    const where2 = where.join(' AND ').replace(/i\./g, 'i2.');
    const [items] = await pool.query(
      `SELECT ii.*, i.invoice_number, i.invoice_date, i.customer_name, i.customer_gstin,
              i.place_of_supply, i.is_interstate FROM invoice_items ii
       JOIN invoices i ON i.id=ii.invoice_id
       WHERE i.id IN (SELECT id FROM invoices i2 WHERE ${where2})
       ORDER BY i.invoice_date`,
      [...params]
    );
    // merge
    const invMap = {};
    invoices.forEach((inv) => (invMap[inv.id] = { ...inv, items: [] }));
    items.forEach((it) => {
      if (invMap[it.invoice_id]) invMap[it.invoice_id].items.push(it);
    });
    const data = Object.values(invMap);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="invoices-export.csv"');
    res.send(invoicesCsv(data));
  } catch (e) {
    next(e);
  }
}

async function exportXml(req, res, next) {
  try {
    const { from, to } = req.query;
    const pool = getPool();
    const params = [];
    let where = `status NOT IN ('CANCELLED')`;
    if (from) { where += ' AND invoice_date >= ?'; params.push(from); }
    if (to) { where += ' AND invoice_date <= ?'; params.push(to); }
    const [invoices] = await pool.query(`SELECT * FROM invoices WHERE ${where} ORDER BY invoice_date`, params);
    const ids = invoices.map((i) => i.id);
    const [items] = ids.length
      ? await pool.query(
          `SELECT * FROM invoice_items WHERE invoice_id IN (${ids.map(() => '?').join(',')}) ORDER BY invoice_id`,
          ids
        )
      : [[]];
    const invMap = {};
    invoices.forEach((inv) => (invMap[inv.id] = { ...inv, items: [] }));
    items.forEach((it) => {
      if (invMap[it.invoice_id]) invMap[it.invoice_id].items.push(it);
    });
    const [company] = await pool.query('SELECT * FROM company_settings ORDER BY id LIMIT 1');
    const xml = tallyXml(Object.values(invMap), company[0]);

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', 'attachment; filename="tally-vouchers.xml"');
    res.send(xml);
  } catch (e) {
    next(e);
  }
}

module.exports = {
  dashboard,
  salesReport,
  gstr1,
  gstr3b,
  exportCsv,
  exportXml,
};