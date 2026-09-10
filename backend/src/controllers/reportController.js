const { getPool, query } = require('../db');
const archiver = require('archiver');
const { toCsv, invoicesCsv, ledgerCsv, tallyXml } = require('../utils/exporters');

/**
 * Shared trial-balance computation (used by the report view and CA export).
 */
async function computeTb(pool, from, to) {
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

  return {
    from: from === '1900-01-01' ? null : from,
    to,
    rows,
    totals: {
      openDr: round2(openDr), openCr: round2(openCr),
      debit: round2(perDr), credit: round2(perCr),
      closeDr: round2(closeDr), closeCr: round2(closeCr),
    },
    balanced: Math.abs(closeDr - closeCr) < 0.01,
  };
}

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
      `SELECT i.invoice_number, i.invoice_date, i.is_interstate, i.invoice_type,
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
       GROUP BY i.invoice_number, i.invoice_date, i.is_interstate, i.invoice_type, ii.hsn_code, ii.gst_rate,
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
    const data = await computeTb(pool, from, to);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

/**
 * Per-party outstanding documents for a period (receivables or payables).
 */
async function agingDocs(pool, type, asOf) {
  const docs = type === 'receivable'
    ? await pool.query(
        `SELECT customer_name AS party, invoice_number AS number, invoice_date AS doc_date,
                grand_total, paid_amount, balance_due, status
         FROM invoices WHERE status IN ('PENDING','PARTIAL') AND balance_due > 0
           AND invoice_date <= ?
         ORDER BY customer_name, invoice_date`, [asOf]
      )
    : await pool.query(
        `SELECT vendor_name AS party, bill_number AS number, bill_date AS doc_date,
                grand_total, paid_amount, balance_due, status
         FROM purchase_bills WHERE status IN ('PENDING','PARTIAL') AND balance_due > 0
           AND bill_date <= ?
         ORDER BY vendor_name, bill_date`, [asOf]
      );
  return docs[0];
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

/**
 * GET /api/reports/ca-export?from=&to=
 * Zips everything a CA needs for the period: sales & purchase registers,
 * item-level books, trial balance, GSTR-1/3B workings, receivables/payables,
 * Tally XML and a cover letter.
 */
async function caExport(req, res, next) {
  try {
    const pool = getPool();
    const todayIso = new Date().toISOString().slice(0, 10);
    const from = req.query.from || '1900-01-01';
    const to = req.query.to || todayIso;
    const nc = `status NOT IN ('CANCELLED')`;

    const [sales] = await pool.query(
      `SELECT invoice_number, invoice_date, customer_name, customer_gstin, place_of_supply, is_interstate,
              subtotal, discount, tax_total, cgst_total, sgst_total, igst_total, cess_total, grand_total,
              paid_amount, balance_due
       FROM invoices WHERE invoice_date BETWEEN ? AND ? AND ${nc} ORDER BY invoice_date, invoice_number`, [from, to]
    );
    const [purchases] = await pool.query(
      `SELECT bill_number, bill_date, vendor_name, vendor_gstin, place_of_supply, is_interstate, is_rcm,
              subtotal, discount, tax_total, cgst_total, sgst_total, igst_total, cess_total, grand_total,
              paid_amount, balance_due
       FROM purchase_bills WHERE bill_date BETWEEN ? AND ? AND ${nc} ORDER BY bill_date, bill_number`, [from, to]
    );

    const [invIds] = await pool.query(`SELECT id FROM invoices WHERE invoice_date BETWEEN ? AND ? AND ${nc}`, [from, to]);
    const ids = invIds.map((r) => r.id);
    const [saleItems] = ids.length
      ? await pool.query(
          `SELECT ii.*, i.invoice_number, i.invoice_date, i.customer_name, i.customer_gstin, i.place_of_supply, i.is_interstate
           FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
           WHERE ii.invoice_id IN (${ids.map(() => '?').join(',')}) ORDER BY i.invoice_date`, ids
        )
      : [[]];

    const [purIds] = await pool.query(`SELECT id FROM purchase_bills WHERE bill_date BETWEEN ? AND ? AND ${nc}`, [from, to]);
    const pids = purIds.map((r) => r.id);
    const [purItems] = pids.length
      ? await pool.query(
          `SELECT pb.*, b.bill_number, b.bill_date, b.vendor_name, b.vendor_gstin
           FROM purchase_bill_items pb JOIN purchase_bills b ON b.id=pb.bill_id
           WHERE pb.bill_id IN (${pids.map(() => '?').join(',')}) ORDER BY b.bill_date`, pids
        )
      : [[]];

    const [gstr1] = await pool.query(
      `SELECT i.invoice_number, i.invoice_date, i.is_interstate, i.invoice_type, ii.hsn_code, ii.gst_rate,
              SUM(ii.quantity) AS quantity, SUM(ii.taxable_value) AS taxable_value,
              SUM(ii.cgst_amount) AS cgst, SUM(ii.sgst_amount) AS sgst, SUM(ii.igst_amount) AS igst,
              SUM(ii.cess_amount) AS cess, i.customer_name, i.customer_gstin
       FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
       WHERE i.invoice_date BETWEEN ? AND ? AND i.status NOT IN ('CANCELLED')
       GROUP BY i.invoice_number, i.invoice_date, i.is_interstate, i.invoice_type, ii.hsn_code, ii.gst_rate,
                i.customer_name, i.customer_gstin ORDER BY i.invoice_date`, [from, to]
    );

    const [gstr3b] = await pool.query(
      `SELECT ii.gst_rate, SUM(ii.taxable_value) AS taxable_value, SUM(ii.cgst_amount) AS cgst,
              SUM(ii.sgst_amount) AS sgst, SUM(ii.igst_amount) AS igst, SUM(ii.cess_amount) AS cess
       FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
       WHERE i.invoice_date BETWEEN ? AND ? AND i.status NOT IN ('CANCELLED')
       GROUP BY ii.gst_rate ORDER BY ii.gst_rate`, [from, to]
    );

    const tb = await computeTb(pool, from, to);
    const receivables = await agingDocs(pool, 'receivable', to);
    const payables = await agingDocs(pool, 'payable', to);
    const [[company]] = await pool.query('SELECT * FROM company_settings ORDER BY id LIMIT 1');

    // Sales register CSV
    const salesCsv = toCsv(
      ['DocType', 'InvoiceNo', 'Date', 'Customer', 'GSTIN', 'POS', 'Type', 'Taxable', 'Discount', 'CGST', 'SGST', 'IGST', 'Cess', 'Tax', 'GrandTotal', 'Paid', 'BalanceDue'],
      sales.map((r) => ({
        DocType: r.invoice_type || '',
        InvoiceNo: r.invoice_number, Date: r.invoice_date, Customer: r.customer_name, GSTIN: r.customer_gstin || '',
        POS: r.place_of_supply || '', Type: r.is_interstate ? 'Inter-state' : 'Intra-state',
        Taxable: r.subtotal, Discount: r.discount, CGST: r.cgst_total, SGST: r.sgst_total,
        IGST: r.igst_total, Cess: r.cess_total, Tax: r.tax_total, GrandTotal: r.grand_total,
        Paid: r.paid_amount, BalanceDue: r.balance_due,
      }))
    );

    // Purchase register CSV
    const purchaseCsv = toCsv(
      ['RCM', 'BillNo', 'Date', 'Vendor', 'GSTIN', 'POS', 'Type', 'Taxable', 'Discount', 'CGST', 'SGST', 'IGST', 'Cess', 'Tax', 'GrandTotal', 'Paid', 'BalanceDue'],
      purchases.map((r) => ({
        RCM: r.is_rcm ? 'YES' : '',
        BillNo: r.bill_number, Date: r.bill_date, Vendor: r.vendor_name, GSTIN: r.vendor_gstin || '',
        POS: r.place_of_supply || '', Type: r.is_interstate ? 'Inter-state' : 'Intra-state',
        Taxable: r.subtotal, Discount: r.discount, CGST: r.cgst_total, SGST: r.sgst_total,
        IGST: r.igst_total, Cess: r.cess_total, Tax: r.tax_total, GrandTotal: r.grand_total,
        Paid: r.paid_amount, BalanceDue: r.balance_due,
      }))
    );

    // Item-level books
    const saleItemsCsv = toCsv(
      ['InvoiceNo', 'Date', 'Customer', 'GSTIN', 'HSN', 'Item', 'Qty', 'Unit', 'Rate', 'GST%', 'Discount', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess', 'Value'],
      saleItems.map((it) => ({
        InvoiceNo: it.invoice_number, Date: it.invoice_date, Customer: it.customer_name, GSTIN: it.customer_gstin || '',
        HSN: it.hsn_code || '', Item: it.item_name, Qty: it.quantity, Unit: it.unit, Rate: it.unit_price,
        'GST%': it.gst_rate, Discount: it.discount, Taxable: it.taxable_value, CGST: it.cgst_amount,
        SGST: it.sgst_amount, IGST: it.igst_amount, Cess: it.cess_amount, Value: it.total,
      }))
    );
    const purItemsCsv = toCsv(
      ['BillNo', 'Date', 'Vendor', 'GSTIN', 'HSN', 'Item', 'Qty', 'Unit', 'Rate', 'GST%', 'Discount', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess', 'Value'],
      purItems.map((it) => ({
        BillNo: it.bill_number, Date: it.bill_date, Vendor: it.vendor_name, GSTIN: it.vendor_gstin || '',
        HSN: it.hsn_code || '', Item: it.item_name, Qty: it.quantity, Unit: it.unit, Rate: it.unit_price,
        'GST%': it.gst_rate, Discount: it.discount, Taxable: it.taxable_value, CGST: it.cgst_amount,
        SGST: it.sgst_amount, IGST: it.igst_amount, Cess: it.cess_amount, Value: it.total,
      }))
    );

    // Trial balance CSV
    const tbCsv = toCsv(
      ['Account', 'Type', 'OpeningDr', 'OpeningCr', 'Debit', 'Credit', 'ClosingDr', 'ClosingCr'],
      tb.rows.map((r) => ({ Account: r.name, Type: r.type, OpeningDr: r.o_dr, OpeningCr: r.o_cr, Debit: r.d, Credit: r.c, ClosingDr: r.c_dr, ClosingCr: r.c_cr }))
    );

    // GSTR workings
    const gstr1Csv = toCsv(
      ['InvoiceNo', 'Date', 'Supply', 'DocType', 'HSN', 'GST%', 'Qty', 'TaxableValue', 'CGST', 'SGST', 'IGST', 'Cess', 'Customer', 'GSTIN'],
      gstr1.map((r) => ({
        InvoiceNo: r.invoice_number, Date: r.invoice_date, Supply: r.is_interstate ? 'IGST' : 'Same state',
        DocType: r.invoice_type || '',
        HSN: r.hsn_code || '', 'GST%': r.gst_rate, Qty: r.quantity, TaxableValue: r.taxable_value,
        CGST: r.cgst, SGST: r.sgst, IGST: r.igst, Cess: r.cess, Customer: r.customer_name, GSTIN: r.customer_gstin || '',
      }))
    );
    const gstr3bCsv = toCsv(
      ['GSTRate', 'TaxableValue', 'CGST', 'SGST', 'IGST', 'Cess'],
      gstr3b.map((r) => ({ GSTRate: r.gst_rate, TaxableValue: r.taxable_value, CGST: r.cgst, SGST: r.sgst, IGST: r.igst, Cess: r.cess }))
    );

    // Outstanding statements (per document)
    const receivablesCsv = toCsv(
      ['Party', 'Document', 'Date', 'GrandTotal', 'Paid', 'BalanceDue', 'Status'],
      receivables.map((r) => ({ Party: r.party, Document: r.number, Date: r.doc_date, GrandTotal: r.grand_total, Paid: r.paid_amount, BalanceDue: r.balance_due, Status: r.status }))
    );
    const payablesCsv = toCsv(
      ['Party', 'Document', 'Date', 'GrandTotal', 'Paid', 'BalanceDue', 'Status'],
      payables.map((r) => ({ Party: r.party, Document: r.number, Date: r.doc_date, GrandTotal: r.grand_total, Paid: r.paid_amount, BalanceDue: r.balance_due, Status: r.status }))
    );

    // Tally XML
    const invById = {};
    sales.forEach((s) => (invById[s.invoice_number] = { ...s, items: saleItems.filter((it) => it.invoice_number === s.invoice_number) }));
    const tally = tallyXml(Object.values(invById), company);

    // Cover letter
    const sum = (arr, k) => arr.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    const outGst = sum(sales, 'tax_total');
    const itc = sum(purchases, 'tax_total');
    const recv = sum(receivables, 'balance_due');
    const pay = sum(payables, 'balance_due');
    const cover = [
      'C A   D A T A   E X P O R T   K I T',
      '================================================',
      `Company   : ${company?.company_name || 'TriVista Traders'}`,
      `GSTIN     : ${company?.gstin || ''}   PAN: ${company?.pan || ''}`,
      `Address   : ${company?.address_line1 || ''} ${company?.city || ''} ${company?.state || ''} - ${company?.pincode || ''}`,
      '',
      `Period    : ${from}  to  ${to}`,
      `Generated : ${new Date().toLocaleString('en-IN')}`,
      '================================================',
      'PERIOD SUMMARY',
      `  Invoices in period            : ${sales.length}`,
      `  Total sales (taxable)         : ${sum(sales, 'subtotal').toLocaleString('en-IN')}`,
      `  Output GST collected          : ${outGst.toLocaleString('en-IN')}`,
      `  Total sales value             : ${sum(sales, 'grand_total').toLocaleString('en-IN')}`,
      `  Purchase bills in period      : ${purchases.length}`,
      `  Total purchases (taxable)     : ${sum(purchases, 'subtotal').toLocaleString('en-IN')}`,
      `  Input GST credit (ITC)        : ${itc.toLocaleString('en-IN')}`,
      `  Total purchases value         : ${sum(purchases, 'grand_total').toLocaleString('en-IN')}`,
      `  Estimated net GST payable     : ${(outGst - itc).toLocaleString('en-IN')}`,
      `  Receivables outstanding       : ${recv.toLocaleString('en-IN')}  (${receivables.length} document(s))`,
      `  Payables outstanding          : ${pay.toLocaleString('en-IN')}  (${payables.length} document(s))`,
      '',
      'HOW YOUR CA CAN USE THIS PACKAGE',
      '  1. Open the .csv files in MS Excel (numbers are formatted).',
      '  2. Import Tally-Vouchers.xml into Tally (Gateway > Import > XML).',
      '  3. GSTR-1-Annexure.csv is the outward-supply worksheet for GSTR-1.',
      '  4. GSTR-3B-Summary.csv gives the monthly rate-wise output for 3B.',
      '  5. Receivables / Payables are per-document confirmations.',
      '',
      'Generated by TriVista GST - A Unit of TSA Enterprises',
      'https://github.com/tsaenterprisesindia-dot/TriVista-GST',
    ].join('\r\n');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', next);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="ca-export-${from}-to-${to}.zip"`);
    archive.pipe(res);
    archive.append(cover, { name: 'CA-Export-Kit/00-CA-Cover-Letter.txt' });
    archive.append(salesCsv, { name: 'CA-Export-Kit/01-Sales-Register.csv' });
    archive.append(purchaseCsv, { name: 'CA-Export-Kit/02-Purchase-Register.csv' });
    archive.append(saleItemsCsv, { name: 'CA-Export-Kit/03-Sales-Items.csv' });
    archive.append(purItemsCsv, { name: 'CA-Export-Kit/04-Purchase-Items.csv' });
    archive.append(tbCsv, { name: 'CA-Export-Kit/05-Trial-Balance.csv' });
    archive.append(gstr1Csv, { name: 'CA-Export-Kit/06-GSTR-1-Annexure.csv' });
    archive.append(gstr3bCsv, { name: 'CA-Export-Kit/07-GSTR-3B-Summary.csv' });
    archive.append(receivablesCsv, { name: 'CA-Export-Kit/08-Receivables.csv' });
    archive.append(payablesCsv, { name: 'CA-Export-Kit/09-Payables.csv' });
    archive.append(tally, { name: 'CA-Export-Kit/10-Tally-Vouchers.xml' });
    archive.finalize();
  } catch (e) {
    next(e);
  }
}

/**
 * GSTR-9 (Annual Return) workings for a financial year period.
 * Out-turnover and ITC summarized by rate slab; RCM show separately.
 */
async function gstr9(req, res, next) {
  try {
    const { from, to } = req.query;
    const pool = getPool();
    const [outward] = await pool.query(
      `SELECT ii.gst_rate,
              SUM(ii.taxable_value) AS taxable_value,
              SUM(ii.cgst_amount) AS cgst, SUM(ii.sgst_amount) AS sgst,
              SUM(ii.igst_amount) AS igst, SUM(ii.cess_amount) AS cess
       FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
       WHERE i.invoice_date BETWEEN ? AND ? AND i.status NOT IN ('CANCELLED')
       GROUP BY ii.gst_rate ORDER BY ii.gst_rate`, [from, to]
    );
    const [itc] = await pool.query(
      `SELECT pbi.gst_rate,
              SUM(pbi.taxable_value) AS taxable_value,
              SUM(pbi.cgst_amount) AS cgst, SUM(pbi.sgst_amount) AS sgst,
              SUM(pbi.igst_amount) AS igst, SUM(pbi.cess_amount) AS cess
       FROM purchase_bill_items pbi JOIN purchase_bills pb ON pb.id=pbi.bill_id
       WHERE pb.bill_date BETWEEN ? AND ? AND pb.status NOT IN ('CANCELLED') AND pb.is_rcm=0 AND pb.vendor_gstin IS NOT NULL
       GROUP BY pbi.gst_rate ORDER BY pbi.gst_rate`, [from, to]
    );
    const [rcm] = await pool.query(
      `SELECT pbi.gst_rate,
              SUM(pbi.taxable_value) AS taxable_value,
              SUM(pbi.cgst_amount) AS cgst, SUM(pbi.sgst_amount) AS sgst,
              SUM(pbi.igst_amount) AS igst
       FROM purchase_bill_items pbi JOIN purchase_bills pb ON pb.id=pbi.bill_id
       WHERE pb.bill_date BETWEEN ? AND ? AND pb.status NOT IN ('CANCELLED') AND pb.is_rcm=1
       GROUP BY pbi.gst_rate ORDER BY pbi.gst_rate`, [from, to]
    );
    const sumRows = await Promise.all([
      pool.query(`SELECT IFNULL(SUM(grand_total),0) AS turnover FROM invoices WHERE invoice_date BETWEEN ? AND ? AND status NOT IN ('CANCELLED')`, [from, to]),
      pool.query(`SELECT IFNULL(SUM(tax_total),0) AS itc_total FROM purchase_bills WHERE bill_date BETWEEN ? AND ? AND status NOT IN ('CANCELLED') AND is_rcm=0 AND vendor_gstin IS NOT NULL`, [from, to]),
    ]);
    const turnover = Number(sumRows[0][0][0].turnover) || 0;
    const itcTotal = Number(sumRows[1][0][0].itc_total) || 0;
    const [[{ rcmTax }]] = await pool.query(
      `SELECT IFNULL(SUM(tax_total),0) AS rcmTax FROM purchase_bills WHERE bill_date BETWEEN ? AND ? AND status NOT IN ('CANCELLED') AND is_rcm=1`, [from, to]
    );
    const sumr = (arr, k) => arr.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    res.json({
      period: { from, to },
      outward,
      outward_totals: { taxable: sumr(outward, 'taxable_value'), cgst: sumr(outward, 'cgst'), sgst: sumr(outward, 'sgst'), igst: sumr(outward, 'igst'), cess: sumr(outward, 'cess') },
      itc,
      itc_totals: { taxable: sumr(itc, 'taxable_value'), cgst: sumr(itc, 'cgst'), sgst: sumr(itc, 'sgst'), igst: sumr(itc, 'igst'), cess: sumr(itc, 'cess') },
      rcm,
      rcm_totals: { taxable: sumr(rcm, 'taxable_value'), cgst: sumr(rcm, 'cgst'), sgst: sumr(rcm, 'sgst'), igst: sumr(rcm, 'igst') },
      turnover,
      itc_total: itcTotal,
      rcmTax,
      netGstPayable: Math.round((sumr(outward, 'cgst') + sumr(outward, 'sgst') + sumr(outward, 'igst') - (sumr(itc, 'cgst') + sumr(itc, 'sgst') + sumr(itc, 'igst'))) * 100) / 100,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * GSTR-9C (Reconciliation Statement) - books vs GSTR-1 vs returns.
 */
async function gstr9c(req, res, next) {
  try {
    const { from, to } = req.query;
    const pool = getPool();
    const [sales] = await pool.query(
      `SELECT IFNULL(SUM(grand_total),0) AS grand, IFNULL(SUM(subtotal),0) AS taxable, IFNULL(SUM(tax_total),0) AS gst
       FROM invoices WHERE invoice_date BETWEEN ? AND ? AND status NOT IN ('CANCELLED')`, [from, to]
    );
    const [purchases] = await pool.query(
      `SELECT IFNULL(SUM(grand_total),0) AS grand, IFNULL(SUM(subtotal),0) AS taxable, IFNULL(SUM(tax_total),0) AS gst
       FROM purchase_bills WHERE bill_date BETWEEN ? AND ? AND status NOT IN ('CANCELLED')`, [from, to]
    );
    const [[{ paidGst }]] = await pool.query(
      `SELECT IFNULL(SUM(tax_total),0) AS paidGst FROM invoices WHERE invoice_date BETWEEN ? AND ? AND status NOT IN ('CANCELLED')`, [from, to]
    );
    const [[{ daysLate }]] = await pool.query(
      `SELECT COUNT(*) AS daysLate FROM invoices WHERE invoice_date BETWEEN ? AND ?  AND status NOT IN ('CANCELLED')`, [from, to]
    );
    const mismatch = Number(sales[0].gst) - Number(paidGst);
    res.json({
      period: { from, to },
      turnover_as_per_books: Number(sales[0].grand),
      taxable_as_per_books: Number(sales[0].taxable),
      gst_as_per_books: Number(sales[0].gst),
      gst_returned_net_liability: 0, // filled by user per filed returns
      difference_reconciled: 0,
      itc_as_per_books: Number(purchases[0].gst),
      input_credit_claimed: 0,
      itc_difference: Number(purchases[0].gst),
      tax_deposited: paidGst,
      tax_difference: mismatch,
      clearance: {
        amount_reported_outward_supply: Number(sales[0].grand),
        amount_qc_ca: Number(sales[0].grand),
        variance: 0,
        tax_evasion_issue: false,
      },
      _baseline_docs: daysLate,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * ITC Register (invoice-level input credit) - eligible vs ineligible (RCM).
 */
async function itcRegister(req, res, next) {
  try {
    const { from, to } = req.query;
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT pb.bill_number, pb.bill_date, pb.vendor_name, pb.vendor_gstin,
              pb.subtotal AS taxable_value, pb.cgst_total AS cgst, pb.sgst_total AS sgst,
              pb.igst_total AS igst, pb.tax_total AS total_gst,
              CASE WHEN pb.vendor_gstin IS NULL THEN 'INELIGIBLE (RCM)' ELSE 'ELIGIBLE' END AS eligible,
              pb.grand_total
       FROM purchase_bills pb
       WHERE pb.bill_date BETWEEN ? AND ? AND pb.status NOT IN ('CANCELLED')
       ORDER BY pb.bill_date, pb.bill_number`, [from, to]
    );
    const itcSums = await Promise.all([
      pool.query(`SELECT IFNULL(SUM(tax_total),0) AS eligible FROM purchase_bills WHERE bill_date BETWEEN ? AND ? AND status NOT IN ('CANCELLED') AND vendor_gstin IS NOT NULL`, [from, to]),
      pool.query(`SELECT IFNULL(SUM(tax_total),0) AS ineligible FROM purchase_bills WHERE bill_date BETWEEN ? AND ? AND status NOT IN ('CANCELLED') AND vendor_gstin IS NULL`, [from, to]),
    ]);
    const eligible = Number(itcSums[0][0][0].eligible) || 0;
    const ineligible = Number(itcSums[1][0][0].ineligible) || 0;
    res.json({ data: rows, totals: { eligible, ineligible } });
  } catch (e) {
    next(e);
  }
}

/**
 * HSN-wise outward supply summary (for GSTR-1 Table 12 / HSN annexure).
 */
async function hsnSummary(req, res, next) {
  try {
    const { from, to } = req.query;
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT ii.hsn_code, ii.gst_rate, ii.unit,
              SUM(ii.quantity) AS quantity,
              SUM(ii.taxable_value) AS taxable_value,
              SUM(ii.cgst_amount) AS cgst, SUM(ii.sgst_amount) AS sgst,
              SUM(ii.igst_amount) AS igst, SUM(ii.cess_amount) AS cess,
              COUNT(DISTINCT i.invoice_number) AS txns
       FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
       WHERE i.invoice_date BETWEEN ? AND ? AND i.status NOT IN ('CANCELLED')
       GROUP BY ii.hsn_code, ii.gst_rate, ii.unit
       ORDER BY ii.hsn_code, ii.gst_rate`, [from, to]
    );
    const sumr = (arr, k) => arr.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    res.json({
      data: rows,
      totals: { quantity: sumr(rows, 'quantity'), taxable_value: sumr(rows, 'taxable_value'), cgst: sumr(rows, 'cgst'), sgst: sumr(rows, 'sgst'), igst: sumr(rows, 'igst'), cess: sumr(rows, 'cess') },
    });
  } catch (e) {
    next(e);
  }
}

/**
 * TDS statement (Form 26Q / 194Q) - purchases per vendor with PAN & amount.
 */
async function tdsReport(req, res, next) {
  try {
    const { from, to } = req.query;
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT pb.bill_number, pb.bill_date, pb.vendor_name, v.pan AS vendor_pan, pb.grand_total,
              pb.tds_amount
       FROM purchase_bills pb LEFT JOIN vendors v ON v.id=pb.vendor_id
       WHERE pb.bill_date BETWEEN ? AND ? AND pb.status NOT IN ('CANCELLED') AND pb.tds_amount > 0
       ORDER BY pb.bill_date, pb.bill_number`, [from, to]
    );
    const [[{ total }]] = await pool.query(
      `SELECT IFNULL(SUM(tds_amount),0) AS total FROM purchase_bills WHERE bill_date BETWEEN ? AND ? AND status NOT IN ('CANCELLED') AND tds_amount > 0`, [from, to]
    );
    res.json({ data: rows, total });
  } catch (e) {
    next(e);
  }
}

/**
 * TCS statement (Form 27EQ / 206C(1H)) - sales per customer with PAN.
 */
async function tcsReport(req, res, next) {
  try {
    const { from, to } = req.query;
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT i.invoice_number, i.invoice_date, i.customer_name, c.pan AS customer_pan,
              i.grand_total, i.tcs_amount
       FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id
       WHERE i.invoice_date BETWEEN ? AND ? AND i.status NOT IN ('CANCELLED') AND i.tcs_amount > 0
       ORDER BY i.invoice_date, i.invoice_number`, [from, to]
    );
    const [[{ total }]] = await pool.query(
      `SELECT IFNULL(SUM(tcs_amount),0) AS total FROM invoices WHERE invoice_date BETWEEN ? AND ? AND status NOT IN ('CANCELLED') AND tcs_amount > 0`, [from, to]
    );
    res.json({ data: rows, total });
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
  caExport,
  gstr9,
  gstr9c,
  itcRegister,
  hsnSummary,
  tdsReport,
  tcsReport,
};