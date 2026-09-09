const { getPool } = require('../db');
const { splitGst, round2 } = require('../utils/gst');
const { pad } = require('../utils/helpers');

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

    const [mx] = await conn.query('SELECT COALESCE(MAX(id),0) AS mx FROM purchase_bills');
    // For GSTR-2A matching "supplier invoice no" matters, not our series.
    const billNumber = `PB-${pad((mx[0].mx || 0) + 1, 6)}`;

    let subtotal = 0, discountTotal = 0, cgstTotal = 0, sgstTotal = 0, igstTotal = 0, cessTotal = 0, taxTotal = 0, grandTotal = 0;

    for (const it of b.items) {
      const qty = Number(it.quantity) || 1;
      const rate = Number(it.unit_price) || 0;
      const disc = Number(it.discount) || 0;
      const gstRate = Number(it.gst_rate) || 0;
      const gross = qty * rate;
      const taxableValue = gross - disc;
      const tax = splitGst(taxableValue, gstRate, placeOfSupply, companyState);

      subtotal += gross;
      discountTotal += disc;
      cgstTotal += tax.cgst;
      sgstTotal += tax.sgst;
      igstTotal += tax.igst;
      cessTotal += tax.cess;
      taxTotal += tax.cgst + tax.sgst + tax.igst + tax.cess;
      grandTotal += taxableValue + tax.cgst + tax.sgst + tax.igst + tax.cess;

      // Stock IN for products (goods purchased)
      if (it.product_id) {
        const [p] = await conn.query('SELECT is_service FROM products WHERE id=?', [it.product_id]);
        if (p.length && !p[0].is_service) {
          await conn.query(
            `INSERT INTO stock_movements (product_id,type,quantity,unit_cost,note,created_by)
             VALUES (?,'IN',?,?,?,?)`,
            [it.product_id, qty, rate, `Purchase ${billNumber}`, req.user.id]
          );
        }
      } else if (it.item_name) {
        const [ins] = await conn.query(
          `INSERT INTO products (name,hsn_code,gst_rate,unit,purchase_price,selling_price,is_service)
           VALUES (?,?,?,?,?,?,0)`,
          [it.item_name, it.hsn_code || null, gstRate, it.unit || 'PCS', rate, rate]
        );
        await conn.query(
          `INSERT INTO stock_movements (product_id,type,quantity,unit_cost,note,created_by)
           VALUES (?,'IN',?,?,?,?)`,
          [ins.insertId, qty, rate, `Purchase ${billNumber}`, req.user.id]
        );
      }
    }

    const [ins] = await conn.query(
      `INSERT INTO purchase_bills
       (bill_number,bill_date,due_date,vendor_id,vendor_name,vendor_gstin,place_of_supply,is_interstate,status,
        subtotal,discount,cgst_total,sgst_total,igst_total,cess_total,tax_total,grand_total,paid_amount,balance_due,notes,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        billNumber, b.bill_date || new Date().toISOString().slice(0, 10), b.due_date || null,
        vendor.id, vendor.name, vendor.gstin || null, placeOfSupply, isInterstate ? 1 : 0, 'PENDING',
        round2(subtotal), round2(discountTotal), round2(cgstTotal), round2(sgstTotal), round2(igstTotal),
        round2(cessTotal), round2(taxTotal), round2(grandTotal), 0, round2(grandTotal), b.notes || null, req.user.id,
      ]
    );
    const billId = ins.insertId;

    for (const it of b.items) {
      const qty = Number(it.quantity) || 1;
      const rate = Number(it.unit_price) || 0;
      const disc = Number(it.discount) || 0;
      const gstRate = Number(it.gst_rate) || 0;
      const taxableValue = qty * rate - disc;
      const tax = splitGst(taxableValue, gstRate, placeOfSupply, companyState);
      const pid = it.product_id || (
        (await conn.query("SELECT id FROM products WHERE name=? LIMIT 1", [it.item_name]))[0]?.[0]?.id || null
      );
      await conn.query(
        `INSERT INTO purchase_bill_items
         (bill_id,product_id,item_name,hsn_code,gst_rate,quantity,unit,unit_price,discount,
          taxable_value,cgst_amount,sgst_amount,igst_amount,cess_amount,total)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [billId, pid, it.item_name, it.hsn_code || null, gstRate, qty, it.unit || 'PCS', rate, disc,
         round2(taxableValue), tax.cgst, tax.sgst, tax.igst, tax.cess,
         round2(taxableValue + tax.cgst + tax.sgst + tax.igst + tax.cess)]
      );
    }

    // Payment if included
    let paidAmount = 0;
    const payAmount = Number(b.paid_amount) || 0;
    if (payAmount > 0) {
      paidAmount = Math.min(payAmount, grandTotal);
      await conn.query(
        `INSERT INTO payments (date,amount,mode,reference_no,note,created_by) VALUES (?,?,?,?,?,?)`,
        [b.bill_date, paidAmount, b.payment_mode || 'BANK', null, `Payment for ${billNumber}`, req.user.id]
      );
    }
    const status = paidAmount >= grandTotal ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'PENDING';
    await conn.query(
      'UPDATE purchase_bills SET paid_amount=?, balance_due=?, status=? WHERE id=?',
      [paidAmount, round2(grandTotal - paidAmount), status, billId]
    );

    await conn.commit();
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
  try {
    const id = Number(req.params.id);
    const { amount, mode, date } = req.body || {};
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Valid amount required.' });
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM purchase_bills WHERE id=?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Purchase bill not found.' });
    const bill = rows[0];
    const pay = Math.min(Number(amount), Number(bill.balance_due));
    await pool.query(
      `INSERT INTO payments (date,amount,mode,note,created_by) VALUES (?,?,?,?,?)`,
      [date || new Date().toISOString().slice(0, 10), pay, mode || 'BANK', `Payment for ${bill.bill_number}`, req.user.id]
    );
    const newPaid = round2(Number(bill.paid_amount) + pay);
    const balance = round2(Number(bill.grand_total) - newPaid);
    const status = balance === 0 ? 'PAID' : 'PARTIAL';
    await pool.query('UPDATE purchase_bills SET paid_amount=?, balance_due=?, status=? WHERE id=?', [newPaid, balance, status, id]);
    res.json({ message: 'Payment recorded.', balance_due: balance });
  } catch (e) {
    next(e);
  }
}

// ---------------- P&L ----------------
async function profitLoss(req, res, next) {
  try {
    const { from, to } = req.query;
    const pool = getPool();
    const where = 'date BETWEEN ? AND ?';
    const params = [from, to];
    const [rows] = await pool.query(
      `SELECT a.code,a.name,a.type,
              IFNULL(SUM(tx.debit),0) AS d,
              IFNULL(SUM(tx.credit),0) AS c
       FROM transactions tx JOIN accounts a ON a.id=tx.account_id
       WHERE ${where} GROUP BY a.code,a.name,a.type ORDER BY a.code`, params
    );
    let income = 0, expense = 0;
    for (const r of rows) {
      if (r.type === 'INCOME') income += Number(r.c) - Number(r.d);
      else if (r.type === 'EXPENSE') expense += Number(r.d) - Number(r.c);
    }
    // Also add direct sales from invoices if no journal entries exist
    const [invTotals] = await pool.query(
      `SELECT IFNULL(SUM(subtotal),0) AS sales, IFNULL(SUM(tax_total),0) AS tax_collected
       FROM invoices WHERE invoice_date BETWEEN ? AND ? AND status NOT IN ('CANCELLED')`, params
    );
    if (rows.every((r) => Number(r.d) + Number(r.c) === 0)) {
      income = Number(invTotals[0].sales);
    }
    res.json({
      income,
      expense,
      profit: round2(income - expense),
      rows,
      invoiceSales: invTotals[0].sales,
      invoiceTax: invTotals[0].tax_collected,
    });
  } catch (e) {
    next(e);
  }
}

// ---------------- Balance Sheet ----------------
async function balanceSheet(req, res, next) {
  try {
    const pool = getPool();
    const [accounts] = await pool.query(
      `SELECT a.*, IFNULL(SUM(tx.debit),0)-IFNULL(SUM(tx.credit),0) AS balance
       FROM accounts a LEFT JOIN transactions tx ON tx.account_id=a.id
       GROUP BY a.id,a.code,a.name,a.type,a.parent_id,a.opening_balance,a.is_active,a.created_at
       ORDER BY a.code`
    );
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
    // Compiled position
    const totalAssets = Number(invVal[0].value) + Number(receivable[0].val);
    const totalLiabilities = Number(payable[0].val);

    // aggregate by type
    const byType = {};
    for (const a of accounts) {
      const t = a.type;
      byType[t] = byType[t] || 0;
      byType[t] += Number(a.opening_balance) + Number(a.balance);
    }
    res.json({ accounts, byType, inventoryValue: invVal[0].value, receivables: receivable[0].val, payables: payable[0].val, totalAssets, totalLiabilities });
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