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

/**
 * Trial Balance derived from sales, purchases and payments.
 * Accounts without journal entries still produce a meaningful, balanced
 * statement built from the actual business documents.
 */
async function trialBalance(req, res, next) {
  try {
    const pool = getPool();
    const todayIso = new Date().toISOString().slice(0, 10);
    const from = req.query.from || '1900-01-01';
    const to = req.query.to || todayIso;

    const notCancelled = `status NOT IN ('CANCELLED')`;
    const invPeriod = `SELECT IFNULL(SUM(subtotal),0) AS sales, IFNULL(SUM(tax_total),0) AS tax,
                              IFNULL(SUM(grand_total),0) AS grand, IFNULL(SUM(paid_amount),0) AS paid
                       FROM invoices WHERE invoice_date BETWEEN ? AND ? AND ${notCancelled}`;
    const invBefore = `SELECT IFNULL(SUM(subtotal),0) AS sales, IFNULL(SUM(tax_total),0) AS tax,
                              IFNULL(SUM(grand_total),0) AS grand, IFNULL(SUM(paid_amount),0) AS paid
                       FROM invoices WHERE invoice_date < ? AND ${notCancelled}`;
    const purPeriod = `SELECT IFNULL(SUM(subtotal),0) AS subtotal, IFNULL(SUM(tax_total),0) AS tax,
                              IFNULL(SUM(grand_total),0) AS grand, IFNULL(SUM(paid_amount),0) AS paid
                       FROM purchase_bills WHERE bill_date BETWEEN ? AND ? AND status NOT IN ('CANCELLED')`;
    const purBefore = `SELECT IFNULL(SUM(subtotal),0) AS subtotal, IFNULL(SUM(tax_total),0) AS tax,
                              IFNULL(SUM(grand_total),0) AS grand, IFNULL(SUM(paid_amount),0) AS paid
                       FROM purchase_bills WHERE bill_date < ? AND status NOT IN ('CANCELLED')`;

    const [[invP], [invB], [purP], [purB]] = await Promise.all([
      pool.query(invPeriod, [from, to]),
      pool.query(invBefore, [from]),
      pool.query(purPeriod, [from, to]),
      pool.query(purBefore, [from]),
    ]);

    const rows = [
      { code: 'S1', name: 'Sales Income', type: 'INCOME',
        o_dr: 0, o_cr: invB[0].sales, d: 0, c: invP[0].sales },
      { code: 'L1', name: 'Output GST Payable', type: 'LIABILITY',
        o_dr: 0, o_cr: invB[0].tax, d: 0, c: invP[0].tax },
      { code: 'A1', name: 'Debtors (Customers)', type: 'ASSET',
        o_dr: Number(invB[0].grand) - Number(invB[0].paid), o_cr: 0,
        d: invP[0].grand, c: invP[0].paid },
      { code: 'A2', name: 'Cash & Bank', type: 'ASSET',
        o_dr: invB[0].paid, o_cr: 0, d: invP[0].paid, c: 0 },
      { code: 'E1', name: 'Purchases (Goods)', type: 'EXPENSE',
        o_dr: purB[0].subtotal, o_cr: 0, d: purP[0].subtotal, c: 0 },
      { code: 'A3', name: 'Input GST Credit', type: 'ASSET',
        o_dr: purB[0].tax, o_cr: 0, d: purP[0].tax, c: 0 },
      { code: 'L2', name: 'Creditors (Vendors)', type: 'LIABILITY',
        o_dr: 0, o_cr: Number(purB[0].grand) - Number(purB[0].paid),
        d: purP[0].paid, c: purP[0].grand },
    ];

    const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    for (const r of rows) {
      r.o_dr = round2(r.o_dr);
      r.o_cr = round2(r.o_cr);
      r.d = round2(r.d);
      r.c = round2(r.c);
      const net = (Number(r.o_dr) + Number(r.d)) - (Number(r.o_cr) + Number(r.c));
      r.c_dr = round2(net > 0 ? net : 0);
      r.c_cr = round2(net < 0 ? -net : 0);
    }

    // Opening Capital: balancing equity figure so the closing balance agrees.
    let closeDr = 0, closeCr = 0, openDr = 0, openCr = 0, perDr = 0, perCr = 0;
    for (const r of rows) {
      openDr += r.o_dr; openCr += r.o_cr;
      perDr += r.d; perCr += r.c;
      closeDr += r.c_dr; closeCr += r.c_cr;
    }
    const capitalNet = closeDr - closeCr;
    rows.push({
      code: 'E2', name: 'Opening Capital (Balancing)', type: 'EQUITY',
      o_dr: 0, o_cr: 0, d: 0, c: 0,
      c_dr: round2(capitalNet < 0 ? -capitalNet : 0),
      c_cr: round2(capitalNet > 0 ? capitalNet : 0),
    });
    closeDr += rows[rows.length - 1].c_dr;
    closeCr += rows[rows.length - 1].c_cr;

    res.json({
      from: req.query.from ? from : null,
      to,
      rows,
      totals: {
        openDr: round2(openDr), openCr: round2(openCr),
        debit: round2(perDr), credit: round2(perCr),
        closeDr: round2(closeDr), closeCr: round2(closeCr),
      },
      balanced: Math.abs(closeDr - closeCr) < 0.01,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * Receivables / Payables aging analysis (Current, 31-60, 61-90, 90+).
 */
async function aging(req, res, next) {
  try {
    const pool = getPool();
    const type = req.query.type === 'payable' ? 'payable' : 'receivable';
    const asOf = req.query.asof || new Date().toISOString().slice(0, 10);

    const [docs] = type === 'receivable'
      ? await pool.query(
          `SELECT customer_name AS party, invoice_number AS number, invoice_date AS doc_date,
                  grand_total, paid_amount, balance_due
           FROM invoices WHERE status IN ('PENDING','PARTIAL') AND balance_due > 0
           ORDER BY customer_name, invoice_date`
        )
      : await pool.query(
          `SELECT vendor_name AS party, bill_number AS number, bill_date AS doc_date,
                  grand_total, paid_amount, balance_due
           FROM purchase_bills WHERE status IN ('PENDING','PARTIAL') AND balance_due > 0
           ORDER BY vendor_name, bill_date`
        );

    const bucket = (dateStr) => {
      const days = Math.floor((new Date(asOf) - new Date(dateStr)) / 86400000);
      if (days <= 30) return 'current';
      if (days <= 60) return 'd31_60';
      if (days <= 90) return 'd61_90';
      return 'd90p';
    };

    const map = {};
    for (const d of docs) {
      const party = d.party || 'Unknown';
      map[party] = map[party] || { name: party, billed: 0, paid: 0, due: 0, current: 0, d31_60: 0, d61_90: 0, d90p: 0, count: 0, docs: [] };
      const m = map[party];
      m.billed += Number(d.grand_total) || 0;
      m.paid += Number(d.paid_amount) || 0;
      m.due += Number(d.balance_due) || 0;
      m[bucket(d.doc_date)] += Number(d.balance_due) || 0;
      m.count += 1;
      m.docs.push({ number: d.number, date: d.doc_date, due: Number(d.balance_due) || 0 });
    }

    const rows = Object.values(map).sort((a, b) => b.due - a.due);
    const totals = { billed: 0, paid: 0, due: 0, current: 0, d31_60: 0, d61_90: 0, d90p: 0, count: 0 };
    for (const r of rows) {
      for (const k of ['billed', 'paid', 'due', 'current', 'd31_60', 'd61_90', 'd90p']) totals[k] += Number(r[k]) || 0;
      totals.count += r.count;
    }

    res.json({ type, asOf, rows, totals });
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
  trialBalance,
  aging,
};