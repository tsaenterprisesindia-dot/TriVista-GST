const { getPool } = require('../db');
const { splitGst, round2 } = require('../utils/gst');
const { allocateInvoiceNumber } = require('../utils/invoiceNumber');
const { getActiveBranch } = require('../utils/branch');
const { computeTcs } = require('../utils/tds');
const { audit } = require('../utils/audit');
const ledger = require('../utils/ledger');
const lots = require('../utils/lots');
const payments = require('../utils/payments');

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
          `INSERT INTO customers (customer_code,name,legal_name) VALUES ('CUST-0001','Walk-in Customer','Walk-in Customer')`
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

    let subtotal = 0, discountTotal = 0, cgstTotal = 0, sgstTotal = 0, utgstTotal = 0, igstTotal = 0, cessTotal = 0, taxTotal = 0, grandTotal = 0;
    const saleMoveIds = [];

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
      utgstTotal += tax.utgst;
      igstTotal += tax.igst;
      cessTotal += tax.cess;
      taxTotal += tax.cgst + tax.sgst + tax.utgst + tax.igst + tax.cess;
      grandTotal += taxableValue + tax.cgst + tax.sgst + tax.utgst + tax.igst + tax.cess;

      if (it.product_id) {
        const [p] = await conn.query('SELECT is_service, track_batch, track_serial FROM products WHERE id=?', [it.product_id]);
        if (p.length && !p[0].is_service) {
          const inserted = await lots.issueForSale(conn, {
            product_id: it.product_id, qty,
            note: `POS ${invoiceNumber}`, created_by: req.user.id,
            reference_type: 'pos', reference_id: null,
          });
          saleMoveIds.push(...inserted.map((m) => m.id));
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

    // Payment legs — split (cash + UPI, etc.) must exactly total the rounded
    // grand total; legacy calls pay the full amount in a single mode.
    let legs;
    const parsed = payments.parsePayments(b);
    if (parsed.legs.length) {
      if (Math.abs(parsed.total - grandTotal) > 0.01) {
        throw Object.assign(
          new Error(`Split payment total ${parsed.total} does not match bill total ${grandTotal}.`),
          { status: 400, expose: true }
        );
      }
      legs = parsed.legs;
    } else {
      legs = [{ mode: payments.normalizeMode(b.payment_mode || 'CASH'), amount: grandTotal }];
    }
    const firstLegMode = legs[0].mode;

    const tcsAmount = await computeTcs(
      conn, customer.id, new Date().toISOString().slice(0, 10),
      round2(subtotal - discountTotal), 0, company
    );

    const [ins] = await conn.query(
      `INSERT INTO invoices
       (invoice_number,invoice_date,customer_id,customer_name,status,subtotal,discount,
        cgst_total,sgst_total,utgst_total,igst_total,cess_total,tax_total,round_off,grand_total,
        paid_amount,balance_due,payment_mode,tcs_amount,notes,created_by,place_of_supply,is_interstate,invoice_type)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        invoiceNumber, new Date().toISOString().slice(0, 10), customer.id, customer.name,
        'PAID', round2(subtotal), round2(discountTotal),
        round2(cgstTotal), round2(sgstTotal), round2(utgstTotal), round2(igstTotal), round2(cessTotal),
        round2(taxTotal), roundOff, grandTotal,
        grandTotal, 0,
        firstLegMode, tcsAmount, b.notes || 'POS sale', req.user.id,
        placeOfSupply, isInterstate ? 1 : 0, customer.gstin ? 'B2B' : 'B2C',
      ]
    );
    const invoiceId = ins.insertId;

    if (saleMoveIds.length) {
      const ph = saleMoveIds.map(() => '?').join(',');
      await conn.query(`UPDATE stock_movements SET reference_id=? WHERE id IN (${ph})`, [invoiceId, ...saleMoveIds]);
    }

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
          taxable_value,cgst_amount,sgst_amount,utgst_amount,igst_amount,cess_amount,total)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [invoiceId, it.product_id || null, it.item_name, it.hsn_code || null, gstRate, qty, it.unit || 'PCS',
         rate, disc, round2(taxableValue), tax.cgst, tax.sgst, tax.utgst, tax.igst, tax.cess,
         round2(taxableValue + tax.cgst + tax.sgst + tax.utgst + tax.igst + tax.cess)]
      );
    }

    await payments.recordInvoicePayments(conn, {
      invoice: { id: invoiceId, invoice_number: invoiceNumber, customer_id: customer.id },
      customer_id: customer.id,
      legs,
      date: new Date().toISOString().slice(0, 10),
      created_by: req.user.id,
    });

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
      utgst_total: round2(utgstTotal),
      igst_total: round2(igstTotal),
    }, req.user.id);

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