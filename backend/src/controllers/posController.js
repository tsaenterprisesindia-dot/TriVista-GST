const { getPool } = require('../db');
const { splitGst, round2 } = require('../utils/gst');
const { allocateInvoiceNumber } = require('../utils/invoiceNumber');
const { getActiveBranch } = require('../utils/branch');
const { computeTcs } = require('../utils/tds');
const { audit } = require('../utils/audit');
const ledger = require('../utils/ledger');

/**
 * Sell from POS: creates a paid invoice, deducts stock, returns invoice details.
 * body: { customer_id (defaults to walk-in), items, payment_mode, paid_amount, notes }
 */
async function posSale(req, res, next) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const b = req.body || {};
    if (!b.items || b.items.length === 0) {
      return res.status(400).json({ error: 'No items in cart.' });
    }
    await conn.beginTransaction();

    const branch = await getActiveBranch(conn);
    const [cRows] = await conn.query('SELECT * FROM company_settings ORDER BY id LIMIT 1');
    const company = cRows[0] || {};
    const companyState = branch?.state_code || company.state_code || '29';

    let customer;
    if (b.customer_id) {
      const [c] = await conn.query('SELECT * FROM customers WHERE id=?', [b.customer_id]);
      if (!c.length) throw Object.assign(new Error('Customer not found.'), { status: 404 });
      customer = c[0];
    } else {
      const [walk] = await conn.query("SELECT * FROM customers WHERE customer_code='CUST-0001' LIMIT 1");
      if (!walk.length) {
        // create walk-in on the fly
        const [ins] = await conn.query(
          `INSERT INTO customers (customer_code,name) VALUES ('CUST-0001','Walk-in Customer')`
        );
        const [c] = await conn.query('SELECT * FROM customers WHERE id=?', [ins.insertId]);
        customer = c[0];
      } else {
        customer = walk[0];
      }
    }

    const placeOfSupply = customer.state_code || companyState;
    const isInterstate = String(placeOfSupply) !== String(companyState);

    const invoiceNumber = await allocateInvoiceNumber(conn, branch, new Date().toISOString().slice(0, 10));

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

      if (it.product_id) {
        const [p] = await conn.query('SELECT is_service FROM products WHERE id=?', [it.product_id]);
        if (p.length && !p[0].is_service) {
          const [stk] = await conn.query(
            `SELECT IFNULL(SUM(CASE WHEN type='IN' THEN quantity WHEN type='OUT' THEN -quantity ELSE quantity END),0) AS stock
             FROM stock_movements WHERE product_id=?`,
            [it.product_id]
          );
          if (Number(stk[0].stock) < qty) {
            throw Object.assign(new Error(`Insufficient stock for "${it.item_name}". Only ${stk[0].stock} available.`), { status: 400 });
          }
          await conn.query(
            `INSERT INTO stock_movements (product_id,type,quantity,note,created_by)
             VALUES (?,'OUT',?,'POS ${invoiceNumber}',?)`,
            [it.product_id, qty, req.user.id]
          );
        }
      }
    }

    let roundOff = 0;
    if (Number(company.round_off) === 1) {
      const rounded = Math.round(grandTotal);
      roundOff = round2(rounded - grandTotal);
      grandTotal = rounded;
    }
    grandTotal = round2(grandTotal);

    const tcsAmount = await computeTcs(
      conn, customer.id, new Date().toISOString().slice(0, 10),
      round2(subtotal - discountTotal), 0, company
    );

    const [ins] = await conn.query(
      `INSERT INTO invoices
       (invoice_number,invoice_date,customer_id,customer_name,status,subtotal,discount,
        cgst_total,sgst_total,igst_total,cess_total,tax_total,round_off,grand_total,
        paid_amount,balance_due,payment_mode,tcs_amount,notes,created_by,place_of_supply,is_interstate,invoice_type)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        invoiceNumber, new Date().toISOString().slice(0, 10), customer.id, customer.name,
        'PAID', round2(subtotal), round2(discountTotal),
        round2(cgstTotal), round2(sgstTotal), round2(igstTotal), round2(cessTotal),
        round2(taxTotal), roundOff, grandTotal,
        grandTotal, 0,
        b.payment_mode || 'CASH', tcsAmount, b.notes || 'POS sale', req.user.id,
        placeOfSupply, isInterstate ? 1 : 0, customer.gstin ? 'B2B' : 'B2C',
      ]
    );
    const invoiceId = ins.insertId;

    for (const it of b.items) {
      const qty = Number(it.quantity) || 1;
      const rate = Number(it.unit_price) || 0;
      const disc = Number(it.discount) || 0;
      const gstRate = Number(it.gst_rate) || 0;
      const taxableValue = qty * rate - disc;
      const tax = splitGst(taxableValue, gstRate, placeOfSupply, companyState);
      await conn.query(
        `INSERT INTO invoice_items
         (invoice_id,product_id,item_name,hsn_code,gst_rate,quantity,unit,unit_price,discount,
          taxable_value,cgst_amount,sgst_amount,igst_amount,cess_amount,total)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [invoiceId, it.product_id || null, it.item_name, it.hsn_code || null, gstRate, qty, it.unit || 'PCS',
         rate, disc, round2(taxableValue), tax.cgst, tax.sgst, tax.igst, tax.cess,
         round2(taxableValue + tax.cgst + tax.sgst + tax.igst + tax.cess)]
      );
    }

    const [payIns] = await conn.query(
      `INSERT INTO payments (invoice_id,customer_id,date,amount,mode,note,created_by)
       VALUES (?,?,?,?,?,?,?)`,
      [invoiceId, customer.id, new Date().toISOString().slice(0, 10), grandTotal, b.payment_mode || 'CASH', 'POS full payment', req.user.id]
    );

    // Post double-entry ledgers (idempotent by voucher number)
    await ledger.postSale(conn, {
      id: invoiceId,
      invoice_number: invoiceNumber,
      invoice_date: new Date().toISOString().slice(0, 10),
      customer_name: customer.name,
      grand_total: grandTotal,
      subtotal: round2(subtotal),
      cgst_total: round2(cgstTotal),
      sgst_total: round2(sgstTotal),
      igst_total: round2(igstTotal),
    }, req.user.id);
    await ledger.postSalePayment(conn, {
      invoice: { invoice_number: invoiceNumber },
      amount: grandTotal,
      date: new Date().toISOString().slice(0, 10),
      mode: b.payment_mode || 'CASH',
      payment_id: payIns.insertId,
      created_by: req.user.id,
    });

    await conn.commit();
    await audit(req, 'CREATE', 'invoice', invoiceId, { invoice_number: invoiceNumber, customer_id: customer.id, source: 'POS', grand_total: grandTotal });

    const [full] = await conn.query(
      `SELECT i.*, c.name AS customer_company, c.gstin AS customer_gstin
       FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id WHERE i.id=?`, [invoiceId]
    );
    const [items] = await conn.query('SELECT * FROM invoice_items WHERE invoice_id=?', [invoiceId]);
    const [companyRow] = await conn.query('SELECT * FROM company_settings ORDER BY id LIMIT 1');

    res.status(201).json({
      invoice: full[0],
      items,
      company: companyRow[0] || null,
      message: 'POS sale completed.',
    });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
}

module.exports = { posSale };