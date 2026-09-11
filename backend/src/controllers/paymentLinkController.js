const { getPool } = require('../db');
const crypto = require('crypto');
const { audit } = require('../utils/audit');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const stateLabels = { active: 'Active', paid: 'Paid', cancelled: 'Cancelled' };

function linkFor(req, token) {
  return `${req.protocol}://${req.get('host')}/pay/${token}`;
}

async function create(req, res, next) {
  try {
    const b = req.body || {};
    const invoiceId = Number(b.invoice_id) || null;
    const pool = getPool();
    let amount = b.amount !== undefined && b.amount !== null && b.amount !== '' ? Number(b.amount) : null;
    let note = b.note ? String(b.note).trim() : null;
    let invoice = null;
    if (invoiceId) {
      const [iv] = await pool.query(
        `SELECT id,invoice_number,customer_name,balance_due FROM invoices WHERE id=?`,
        [invoiceId]
      );
      if (!iv.length) return res.status(404).json({ error: 'Invoice not found.' });
      invoice = iv[0];
      const due = Number(invoice.balance_due) || 0;
      if (b.amount === undefined || b.amount === null || b.amount === '') {
        amount = due;
      }
      if (amount === null || isNaN(amount)) amount = 0;
      if (due <= 0 && amount <= 0) {
        return res.status(400).json({ error: `Invoice ${invoice.invoice_number} is already fully paid.` });
      }
      if (!note) note = `Invoice ${invoice.invoice_number}`;
    }
    if (amount === null || isNaN(amount) || amount < 0) {
      return res.status(400).json({ error: 'A valid amount (₹) is required for a standalone link.' });
    }
    const token = crypto.randomBytes(16).toString('hex');
    const [r] = await pool.query(
      `INSERT INTO payment_links (token,invoice_id,amount,note,created_by) VALUES (?,?,?,?,?)`,
      [token, invoiceId, amount, note, req.user.id]
    );
    await audit(req, 'CREATE', 'payment_link', r.insertId, { token, invoice_id: invoiceId, amount, note });
    res.status(201).json({
      id: r.insertId,
      token,
      invoice_id: invoiceId,
      invoice_number: invoice ? invoice.invoice_number : null,
      amount,
      note,
      status: 'active',
      url: linkFor(req, token),
    });
  } catch (e) {
    next(e);
  }
}

async function list(req, res, next) {
  try {
    const { q } = req.query;
    const pool = getPool();
    let where = '';
    const params = [];
    if (q) {
      where = 'WHERE (pl.note LIKE ? OR pl.token LIKE ? OR iv.invoice_number LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    const [rows] = await pool.query(
      `SELECT pl.id,pl.token,pl.invoice_id,pl.amount,pl.note,pl.status,pl.paid_at,pl.created_at,
              iv.invoice_number, iv.customer_name
       FROM payment_links pl
       LEFT JOIN invoices iv ON iv.id=pl.invoice_id
       ${where} ORDER BY pl.id DESC LIMIT 200`,
      params
    );
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
}

async function setStatus(req, nextStatus, res, next) {
  try {
    const { token } = req.params;
    const pool = getPool();
    const [[row]] = await pool.query('SELECT id,status FROM payment_links WHERE token=?', [token]);
    if (!row) return res.status(404).json({ error: 'Payment link not found.' });
    if (row.status === nextStatus) return res.json({ message: `Payment link already ${nextStatus}.` });
    if (row.status !== 'active' && nextStatus === 'paid') {
      return res.status(400).json({ error: 'Only an active link can be marked paid.' });
    }
    if (nextStatus === 'cancelled' && row.status !== 'active') {
      return res.status(400).json({ error: 'Only an active link can be cancelled.' });
    }
    await pool.query(
      nextStatus === 'paid'
        ? `UPDATE payment_links SET status=?, paid_at=NOW() WHERE id=?`
        : `UPDATE payment_links SET status=?, paid_at=NULL WHERE id=?`,
      [nextStatus, row.id]
    );
    await audit(req, nextStatus === 'paid' ? 'MARK_PAID' : 'CANCEL', 'payment_link', row.id, { token });
    res.json({ message: nextStatus === 'paid' ? 'Payment link marked paid.' : 'Payment link cancelled.' });
  } catch (e) {
    next(e);
  }
}

const markPaid = (req, res, next) => setStatus(req, 'paid', res, next);
const cancel = (req, res, next) => setStatus(req, 'cancelled', res, next);

async function invoiceOptions(req, res, next) {
  try {
    const [rows] = await getPool().query(
      `SELECT id,invoice_number,balance_due FROM invoices
       WHERE balance_due > 0 AND status NOT IN ('CANCELLED') ORDER BY id DESC LIMIT 100`
    );
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /pay/:token  (public)
 * Server-rendered shareable collection page with UPI QR + tap-to-pay.
 */
async function renderPay(req, res, next) {
  try {
    const { token } = req.params;
    const pool = getPool();
    const [[row]] = await pool.query(
      `SELECT pl.*, iv.invoice_number, iv.customer_name, c.company_name, c.upi_id, c.upi_beneficiary
       FROM payment_links pl
       LEFT JOIN invoices iv ON iv.id=pl.invoice_id
       LEFT JOIN company_settings c ON 1=1
       WHERE pl.token=? ORDER BY c.id LIMIT 1`,
      [token]
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!row) {
      return res.send(payPage({ title: 'Payment link not found', body: '<p>This payment link is invalid or has been removed.</p>' }));
    }
    const money = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);
    if (row.status !== 'active') {
      const msg = row.status === 'paid' ? 'This payment has already been received.' : 'This payment link has been cancelled.';
      return res.send(payPage({ title: msg, body: `<p>${msg}</p>` }));
    }
    const upiId = String(row.upi_id || '').trim();
    const bene = String(row.upi_beneficiary || row.company_name || '');
    if (!upiId) {
      return res.send(payPage({
        title: 'UPI not configured',
        body: '<p>The seller has not configured a UPI payment ID yet. Please contact the seller directly.</p>',
      }));
    }
    const note = row.note || (row.invoice_number ? `Invoice ${row.invoice_number}` : 'Payment');
    const amt = Number(row.amount) || null;
    const upiUri =
      'upi://pay?pa=' + encodeURIComponent(upiId) +
      (bene ? '&pn=' + encodeURIComponent(bene) : '') +
      '&cu=INR' + (amt ? '&am=' + encodeURIComponent(String(amt)) : '') +
      '&tn=' + encodeURIComponent(note);
    const QRCode = require('qrcode');
    let qr = '';
    try { qr = await QRCode.toDataURL(upiUri, { width: 260, margin: 1 }); } catch { /* no qr */ }
    const body = `
      <div class="pay-box">
        <img class="logo" src="/upi.svg" alt="UPI" width="86" height="39" />
        <div class="payee">${esc(bene)}</div>
        <div class="amt">${amt ? esc(money(amt)) : 'Any amount'}</div>
        <div class="ref">${esc(row.invoice_number ? 'Invoice ' + row.invoice_number + ' · ' : '')}${esc(note)}</div>
        ${qr ? `<div class="qr"><img src="${qr}" alt="UPI QR" width="240" height="240" /></div>` : ''}
        <div class="hint">Scan the QR with any UPI app (GPay, PhonePe, Paytm, BHIM) or tap below.</div>
        <a class="btn" href="${esc(upiUri)}">Pay with UPI app</a>
        <div class="upiid">${esc(upiId)}
          <button type="button" id="copy" onclick="navigator.clipboard.writeText('${esc(upiId)}').then(()=>{this.textContent='Copied!'}) ">Copy</button>
        </div>
        <div class="foot">You will be redirected to your UPI app to confirm.</div>
      </div>`;
    res.send(payPage({ title: `Pay ${esc(bene)}`, body }));
  } catch (e) {
    next(e);
  }
}

function payPage({ title, body }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; background: #f2f6f4; color: #1d3b33;
         min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .pay-box { background: #fff; border: 1px solid #dce8e2; border-radius: 14px; padding: 28px 30px;
             max-width: 360px; width: 100%; text-align: center; box-shadow: 0 6px 24px rgba(16,86,70,.08); }
  .logo { display: block; margin: 0 auto 14px; }
  .payee { font-size: 15px; font-weight: 600; color: #0f513f; }
  .amt { font-size: 30px; font-weight: 700; margin: 8px 0 2px; }
  .ref { font-size: 13px; color: #5a736c; margin-bottom: 14px; }
  .qr { margin: 10px 0; }
  .qr img { border-radius: 8px; border: 1px solid #e3ece7; }
  .hint { font-size: 12.5px; color: #5a736c; margin-bottom: 14px; line-height: 1.5; }
  .btn { display: block; background: #0f9d6e; color: #fff; text-decoration: none; font-weight: 600;
         padding: 13px 16px; border-radius: 10px; margin-bottom: 12px; }
  .btn:hover { background: #0c8a5f; }
  .upiid { font-size: 14px; font-weight: 600; word-break: break-all; margin-bottom: 8px; }
  .upiid button { margin-left: 8px; font: inherit; font-weight: 600; color: #0f9d6e; background: none;
                  border: 1px solid #0f9d6e; border-radius: 8px; padding: 3px 10px; cursor: pointer; }
  .foot { font-size: 12px; color: #8aa39b; }
</style></head><body>${body}</body></html>`;
}

module.exports = { create, list, markPaid, cancel, invoiceOptions, renderPay };