const { getPool } = require('../db');
const { splitGst, round2 } = require('../utils/gst');
const { pad } = require('../utils/helpers');
const { computeTds } = require('../utils/tds');
const { resolveRateForDate } = require('../utils/rateHistory');
const { audit } = require('../utils/audit');
const ledger = require('../utils/ledger');
const lots = require('../utils/lots');
const payments = require('../utils/payments');

/**
 * Create a Purchase Bill (inward supply). Increases stock, records GST input.
 * body: { vendor_id, bill_date, due_date, items:[{product_id?,item_name,hsn_code,quantity,unit,unit_price,discount,gst_rate}], notes, paid_amount }
 */
async function createPurchase(req, res, next) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const b = req.body || {};
    if (!b.vendor_id) return res.status(400).json({ error: 'vendor_id is required.' });
    if (!Array.isArray(b.items) || b.items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required.' });
    }
    await conn.beginTransaction();

    const [cRows] = await conn.query('SELECT * FROM company_settings ORDER BY id LIMIT 1');
    const company = cRows[0] || {};
    const companyState = company.state_code || '29';

    const [vRows] = await conn.query('SELECT * FROM vendors WHERE id=?', [b.vendor_id]);
    if (!vRows.length) throw Object.assign(new Error('Vendor not found.'), { status: 404 });
    const vendor = vRows[0];

    const placeOfSupply = b.place_of_supply || vendor.state_code || companyState;
    const isInterstate = String(placeOfSupply) !== String(companyState);
    const billDate = b.bill_date || new Date().toISOString().slice(0, 10);
    // Reverse Charge (RCM): auto on for unregistered vendors, or when the vendor
// master marks rcm_default (e.g. certain notified services). Explicit body flag wins.
    const isRcm = b.is_rcm !== undefined
      ? Number(b.is_rcm) === 1
      : Number(vendor.rcm_default) === 1 || !vendor.gstin;

    const [mx] = await conn.query('SELECT COALESCE(MAX(id),0) AS mx FROM purchase_bills');
    // For GSTR-2A matching "supplier invoice no" matters, not our series.
    const billNumber = `PB-${pad((mx[0].mx || 0) + 1, 6)}`;

    let subtotal = 0, discountTotal = 0, cgstTotal = 0, sgstTotal = 0, utgstTotal = 0, igstTotal = 0, cessTotal = 0, taxTotal = 0, grandTotal = 0;
    const purchaseMoveIds = [];
    let itemRates = [];

    for (const it of b.items) {
      const qty = Number(it.quantity) || 1;
      const rate = Number(it.unit_price) || 0;
      const disc = Number(it.discount) || 0;
      // Effective-dated rate for the HSN/SAC on the bill date.
      const resolved = await resolveRateForDate(conn, {
        hsnCode: it.hsn_code,
        date: billDate,
        fallbackRate: Number(it.gst_rate) || 0,
      });
      const gstRate = resolved.gst_rate;
      itemRates.push(gstRate);
      const gross = qty * rate;
      const taxableValue = gross - disc;
      const tax = splitGst(taxableValue, gstRate, placeOfSupply, companyState);

      subtotal += gross;
      discountTotal += disc;
      cgstTotal += tax.cgst;
      sgstTotal += tax.sgst;
      utgstTotal += tax.utgst;
      igstTotal += tax.igst;
      cessTotal += tax.cess;
      taxTotal += tax.cgst + tax.sgst + tax.utgst + tax.igst + tax.cess;
      grandTotal += taxableValue + tax.cgst + tax.sgst + tax.utgst + tax.igst + tax.cess;

      // Stock IN for products (goods purchased), with batch/expiry/serial capture
      if (it.product_id) {
        const [p] = await conn.query('SELECT is_service, track_batch, track_serial FROM products WHERE id=?', [it.product_id]);
        if (p.length && !p[0].is_service) {
          let batchId = null;
          if (it.batch_no || p[0].track_batch) {
            if (p[0].track_batch && !it.batch_no) {
              throw Object.assign(new Error(`Product "${it.item_name}" is batch-tracked — provide a batch number.`), { status: 400 });
            }
            batchId = await lots.getOrCreateLot(conn, {
              product_id: it.product_id, batch_no: it.batch_no,
              expiry_date: it.expiry_date, mfg_date: it.mfg_date, created_by: req.user.id,
            });
          }
          const mid = await lots.recordIn(conn, {
            product_id: it.product_id, qty, unit_cost: rate,
            note: `Purchase ${billNumber}`, created_by: req.user.id,
            reference_type: 'purchase', reference_id: null,
            track: { track_batch: p[0].track_batch, track_serial: p[0].track_serial, batch_id: batchId, serial_numbers: it.serial_numbers },
          });
          purchaseMoveIds.push(mid);
        }
      } else if (it.item_name) {
        const [ins] = await conn.query(
          `INSERT INTO products (name,hsn_code,gst_rate,unit,purchase_price,selling_price,is_service)
           VALUES (?,?,?,?,?,?,0)`,
          [it.item_name, it.hsn_code || null, gstRate, it.unit || 'PCS', rate, rate]
        );
        let batchId = null;
        if (it.batch_no) {
          batchId = await lots.getOrCreateLot(conn, {
            product_id: ins.insertId, batch_no: it.batch_no,
            expiry_date: it.expiry_date, mfg_date: it.mfg_date, created_by: req.user.id,
          });
        }
        const mid = await lots.recordIn(conn, {
          product_id: ins.insertId, qty, unit_cost: rate,
          note: `Purchase ${billNumber}`, created_by: req.user.id,
          reference_type: 'purchase', reference_id: null,
          track: { track_batch: 0, track_serial: 0, batch_id: batchId, serial_numbers: it.serial_numbers },
        });
        purchaseMoveIds.push(mid);
      }
    }

    // TDS u/s 194Q on the FY-cumulative purchase value above the threshold
    const tdsAmount = await computeTds(
      conn, vendor.id, billDate,
      round2(subtotal - discountTotal), 0, company
    );

    const [ins] = await conn.query(
      `INSERT INTO purchase_bills
       (bill_number,bill_date,due_date,vendor_id,vendor_name,vendor_gstin,place_of_supply,is_interstate,is_rcm,status,
        subtotal,discount,cgst_total,sgst_total,utgst_total,igst_total,cess_total,tax_total,grand_total,tds_amount,paid_amount,balance_due,notes,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        billNumber, b.bill_date || new Date().toISOString().slice(0, 10), b.due_date || null,
        vendor.id, vendor.name, vendor.gstin || null, placeOfSupply, isInterstate ? 1 : 0, isRcm ? 1 : 0, 'PENDING',
        round2(subtotal), round2(discountTotal), round2(cgstTotal), round2(sgstTotal), round2(utgstTotal), round2(igstTotal),
        round2(cessTotal), round2(taxTotal), round2(grandTotal), tdsAmount, 0, round2(grandTotal), b.notes || null, req.user.id,
      ]
    );
    const billId = ins.insertId;

    if (purchaseMoveIds.length) {
      const ph = purchaseMoveIds.map(() => '?').join(',');
      await conn.query(`UPDATE stock_movements SET reference_id=? WHERE id IN (${ph})`, [billId, ...purchaseMoveIds]);
    }

    for (const [idx, it] of b.items.entries()) {
      const qty = Number(it.quantity) || 1;
      const rate = Number(it.unit_price) || 0;
      const disc = Number(it.discount) || 0;
      const gstRate = itemRates[idx] || Number(it.gst_rate) || 0;
      const taxableValue = qty * rate - disc;
      const tax = splitGst(taxableValue, gstRate, placeOfSupply, companyState);
      const pid = it.product_id || (
        (await conn.query("SELECT id FROM products WHERE name=? LIMIT 1", [it.item_name]))[0]?.[0]?.id || null
      );
      await conn.query(
        `INSERT INTO purchase_bill_items
         (bill_id,product_id,item_name,hsn_code,gst_rate,quantity,unit,unit_price,discount,
          taxable_value,cgst_amount,sgst_amount,utgst_amount,igst_amount,cess_amount,total)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [billId, pid, it.item_name, it.hsn_code || null, gstRate, qty, it.unit || 'PCS', rate, disc,
         round2(taxableValue), tax.cgst, tax.sgst, tax.utgst, tax.igst, tax.cess,
         round2(taxableValue + tax.cgst + tax.sgst + tax.utgst + tax.igst + tax.cess)]
      );
    }

    // Payment if included
    let paidAmount = 0;
    const parsedPay = payments.parsePayments(b, { defaultMode: 'BANK' });
    if (parsedPay.legs.length) {
      const capped = payments.capLegs(parsedPay.legs, round2(grandTotal));
      if (capped.legs.length) {
        paidAmount = capped.total;
        await payments.recordPurchasePayments(conn, {
          bill: { id: billId, bill_number: billNumber },
          legs: capped.legs,
          date: billDate,
          created_by: req.user.id,
        });
      }
    }
    const status = paidAmount >= grandTotal ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'PENDING';
    await conn.query(
      'UPDATE purchase_bills SET paid_amount=?, balance_due=?, status=? WHERE id=?',
      [paidAmount, round2(grandTotal - paidAmount), status, billId]
    );

    // Post double-entry ledgers (idempotent by voucher number)
    await ledger.postPurchase(conn, {
      id: billId,
      bill_number: billNumber,
      bill_date: billDate,
      vendor_name: vendor.name,
      subtotal: round2(subtotal),
      cgst_total: round2(cgstTotal),
      sgst_total: round2(sgstTotal),
      utgst_total: round2(utgstTotal),
      igst_total: round2(igstTotal),
      grand_total: round2(grandTotal),
      is_rcm: isRcm ? 1 : 0,
    }, req.user.id);

    await conn.commit();
    await audit(req, 'CREATE', 'purchase_bill', billId, { bill_number: billNumber, vendor_id: vendor.id, grand_total: round2(grandTotal), tds_amount: tdsAmount });
    res.status(201).json({ id: billId, bill_number: billNumber, grand_total: round2(grandTotal), message: 'Purchase bill created.' });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
}

async function listPurchases(req, res, next) {
  try {
    const { page = 1, limit = 20, q, from, to } = req.query;
    const pool = getPool();
    const where = [];
    const params = [];
    if (q) where.push('(bill_number LIKE ? OR vendor_name LIKE ?)'), params.push(`%${q}%`, `%${q}%`);
    if (from) where.push('bill_date >= ?'), params.push(from);
    if (to) where.push('bill_date <= ?'), params.push(to);
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const offset = (Number(page) - 1) * Number(limit);
    const [rows] = await pool.query(
      `SELECT * FROM purchase_bills ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );
    const [cnt] = await pool.query(`SELECT COUNT(*) AS total FROM purchase_bills ${whereSql}`, params);
    res.json({ data: rows, total: cnt[0].total });
  } catch (e) {
    next(e);
  }
}

async function getPurchase(req, res, next) {
  try {
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM purchase_bills WHERE id=?', [Number(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: 'Purchase bill not found.' });
    const [items] = await pool.query('SELECT * FROM purchase_bill_items WHERE bill_id=?', [rows[0].id]);
    const [vendor] = await pool.query('SELECT * FROM vendors WHERE id=?', [rows[0].vendor_id]);
    res.json({ ...rows[0], items, vendor: vendor[0] || null });
  } catch (e) {
    next(e);
  }
}

async function payPurchase(req, res, next) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    const { date } = req.body || {};
    const legs = payments.parsePayments(req.body || {}, { defaultMode: 'BANK' }).legs;
    if (!legs.length) return res.status(400).json({ error: 'Valid amount required.' });

    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM purchase_bills WHERE id=? FOR UPDATE', [id]);
    if (!rows.length) throw Object.assign(new Error('Purchase bill not found.'), { status: 404 });
    const bill = rows[0];

    const pending = Number(bill.balance_due);
    const capped = payments.capLegs(legs, pending);
    if (capped.total <= 0) return res.status(400).json({ error: 'Valid amount required.' });

    const payDate = date || new Date().toISOString().slice(0, 10);
    await payments.recordPurchasePayments(conn, {
      bill,
      legs: capped.legs,
      date: payDate,
      created_by: req.user.id,
    });

    const newPaid = round2(Number(bill.paid_amount) + capped.total);
    const balance = round2(Number(bill.grand_total) - newPaid);
    const status = balance === 0 ? 'PAID' : 'PARTIAL';
    await conn.query('UPDATE purchase_bills SET paid_amount=?, balance_due=?, status=? WHERE id=?', [newPaid, balance, status, id]);
    await conn.commit();
    await audit(req, 'PAY', 'payment', id, {
      amount: capped.total,
      modes: capped.legs.map((l) => `${l.mode}:${l.amount}`),
      bill_number: bill.bill_number,
    });
    res.json({ message: 'Payment recorded.', balance_due: balance });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
}

// ---------------- P&L ----------------
async function profitLoss(req, res, next) {
  try {
    const { from, to } = req.query;
    const pool = getPool();
    const rep = await ledger.pnlReport(pool, from, to);

    // Fallback for pre-ledger data: straight from the invoices
    const [invTotals] = await pool.query(
      `SELECT IFNULL(SUM(subtotal),0) AS sales, IFNULL(SUM(tax_total),0) AS tax_collected
       FROM invoices WHERE invoice_date BETWEEN ? AND ? AND status NOT IN ('CANCELLED')`, [from || '1900-01-01', to || '9999-12-31']
    );

    const rows = rep.items.map((r) => ({ ...r, opening_balance: 0 }));
    const invoiceSales = invTotals[0].sales;
    const invoiceTax = invTotals[0].tax_collected;
    const source = rep.hasPostings ? 'ledger' : 'documents';

    res.json({
      source,
      income: rep.hasPostings ? rep.income : Number(invoiceSales),
      expense: rep.hasPostings ? rep.expense : 0,
      profit: rep.hasPostings ? rep.profit : round2(Number(invoiceSales)),
      rows,
      invoiceSales,
      invoiceTax,
    });
  } catch (e) {
    next(e);
  }
}

// ---------------- Balance Sheet ----------------
async function balanceSheet(req, res, next) {
  try {
    const { from, to } = req.query;
    const pool = getPool();
    const asOf = to || new Date().toISOString().slice(0, 10);
    const rep = await ledger.balanceSheetReport(pool, asOf);

    const [invVal] = await pool.query(
      `SELECT IFNULL(SUM(q.qty * p.purchase_price),0) AS value FROM
       (SELECT sm.product_id, SUM(CASE WHEN sm.type='IN' THEN sm.quantity WHEN sm.type='OUT' THEN -sm.quantity ELSE sm.quantity END) AS qty
        FROM stock_movements sm GROUP BY sm.product_id HAVING qty>0) q
       JOIN products p ON p.id=q.product_id`
    );
    const [receivable] = await pool.query(
      `SELECT IFNULL(SUM(balance_due),0) AS val FROM invoices WHERE status IN ('PENDING','PARTIAL')`
    );
    const [payable] = await pool.query(
      `SELECT IFNULL(SUM(balance_due),0) AS val FROM purchase_bills WHERE status IN ('PENDING','PARTIAL')`
    );

    const hasLedger = rep.items.some((i) => Math.abs(i.balance) > 0.005);
    const byType = {};
    const accounts = rep.items.map((a) => {
      const balance = hasLedger ? a.balance : 0;
      byType[a.type] = (byType[a.type] || 0) + balance;
      return { ...a, balance };
    });

    // Compiled position
    const totalLiabilities = Number(payable[0].val);
    const receivables = Number(receivable[0].val);
    const inventoryValue = Number(invVal[0].value);

    if (!hasLedger) {
      // Pre-ledger: document-based position (unchanged legacy behaviour)
      byType.ASSET = round2(inventoryValue + receivables);
      byType.LIABILITY = round2(totalLiabilities);
    }

    const totalAssets = hasLedger
      ? round2((byType.ASSET || 0) + inventoryValue)
      : round2(inventoryValue + receivables);

    res.json({
      source: hasLedger ? 'ledger' : 'documents',
      asOf: hasLedger ? asOf : null,
      accounts,
      byType,
      inventoryValue,
      receivables,
      payables: totalLiabilities,
      totalAssets,
      totalLiabilities,
    });
  } catch (e) {
    next(e);
  }
}

// ---------------- Day Book ----------------
async function dayBook(req, res, next) {
  try {
    const { date } = req.query;
    const pool = getPool();
    const d = date || new Date().toISOString().slice(0, 10);
    const [invoices] = await pool.query(
      `SELECT 'Invoice' AS voucher_type, invoice_number AS number, customer_name AS party, invoice_date AS v_date,
              grand_total AS amount, status FROM invoices WHERE invoice_date=? ORDER BY id`, [d]
    );
    const [purchases] = await pool.query(
      `SELECT 'Purchase' AS voucher_type, bill_number AS number, vendor_name AS party, bill_date AS v_date,
              grand_total AS amount, status FROM purchase_bills WHERE bill_date=? ORDER BY id`, [d]
    );
    const [payments] = await pool.query(
      `SELECT 'Payment' AS voucher_type, id AS number, '' AS party, date AS v_date, amount AS amount, 'PAID' AS status
       FROM payments WHERE date=? ORDER BY id`, [d]
    );
    res.json({ date: d, entries: [...payments, ...purchases, ...invoices] });
  } catch (e) {
    next(e);
  }
}

module.exports = { createPurchase, listPurchases, getPurchase, payPurchase, profitLoss, balanceSheet, dayBook };