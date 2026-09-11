const { getPool } = require('../db');

const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Generate (dedupe) alerts from live business data and persist them.
 * Unique per (type, reference_id) so repeated checks never spam duplicates.
 */
async function syncAlerts(pool) {
  const insert = (type, reference_id, title, message, severity, link) =>
    pool.query(
      `INSERT IGNORE INTO notifications (type, reference_id, title, message, severity, link)
       VALUES (?,?,?,?,?,?)`,
      [type, reference_id, title, message, severity, link]
    );

  // --- Receivables: overdue + due soon (+0 days means due today)
  const [overdue] = await pool.query(
    `SELECT i.id, i.invoice_number, i.customer_name, i.balance_due, i.due_date,
            DATEDIFF(CURDATE(), IFNULL(i.due_date, i.invoice_date)) AS days
     FROM invoices i
     WHERE i.status IN ('PENDING','PARTIAL') AND i.balance_due > 0
       AND IFNULL(i.due_date, i.invoice_date) < CURDATE()
     ORDER BY days DESC LIMIT 25`
  );
  for (const r of overdue) {
    await insert(
      'receivable_overdue', r.id,
      `Overdue: ${inr(r.balance_due)} from ${r.customer_name}`,
      `Invoice ${r.invoice_number} is overdue by ${r.days} day(s) (due ${r.due_date || r.invoice_date}).`,
      'important', '/invoices'
    );
  }

  const [dueSoon] = await pool.query(
    `SELECT i.id, i.invoice_number, i.customer_name, i.balance_due, i.due_date,
            DATEDIFF(IFNULL(i.due_date, DATE_ADD(i.invoice_date, INTERVAL 7 DAY)), CURDATE()) AS days
     FROM invoices i
     WHERE i.status IN ('PENDING','PARTIAL') AND i.balance_due > 0
       AND IFNULL(i.due_date, i.invoice_date) >= CURDATE()
       AND IFNULL(i.due_date, DATE_ADD(i.invoice_date, INTERVAL 7 DAY)) <= DATE_ADD(CURDATE(), INTERVAL 3 DAY)
     ORDER BY days ASC LIMIT 25`
  );
  for (const r of dueSoon) {
    await insert(
      'receivable_due_soon', r.id,
      `Due soon: ${inr(r.balance_due)} from ${r.customer_name}`,
      `Invoice ${r.invoice_number} matures in ${r.days} day(s) (${r.due_date || '7 days from invoice'}).`,
      'warning', '/invoices'
    );
  }

  // --- Payables: purchase bills due soon or overdue
  const [purchases] = await pool.query(
    `SELECT pb.id, pb.bill_number, pb.vendor_name, pb.balance_due, pb.due_date,
            DATEDIFF(IFNULL(pb.due_date, DATE_ADD(pb.bill_date, INTERVAL 30 DAY)), CURDATE()) AS days
     FROM purchase_bills pb
     WHERE pb.status IN ('PENDING','PARTIAL') AND pb.balance_due > 0
       AND IFNULL(pb.due_date, DATE_ADD(pb.bill_date, INTERVAL 30 DAY)) <= DATE_ADD(CURDATE(), INTERVAL 3 DAY)
     ORDER BY days ASC LIMIT 25`
  );
  for (const r of purchases) {
    const overduePay = r.days < 0;
    await insert(
      overduePay ? 'payable_overdue' : 'payable_due_soon', r.id,
      `${overduePay ? 'Overdue' : 'Due soon'}: ${inr(r.balance_due)} to ${r.vendor_name}`,
      `Purchase bill ${r.bill_number} ${overduePay ? `is overdue by ${-r.days} day(s)` : `matures in ${r.days} day(s)`}.`,
      overduePay ? 'important' : 'warning', '/accounting'
    );
  }

  // --- Low stock
  const [lowStock] = await pool.query(
    `SELECT p.id, p.name, p.min_stock, q.qty AS on_hand FROM
     (SELECT sm.product_id, SUM(CASE WHEN sm.type='IN' THEN sm.quantity WHEN sm.type='OUT' THEN -sm.quantity ELSE sm.quantity END) AS qty
      FROM stock_movements sm GROUP BY sm.product_id) q
     JOIN products p ON p.id=q.product_id
     WHERE q.qty <= p.min_stock ORDER BY q.qty ASC LIMIT 15`
  );
  for (const r of lowStock) {
    await insert(
      'low_stock', r.id,
      `Low stock: ${r.name}`,
      `Only ${round2(r.on_hand)} left (min ${round2(r.min_stock)}).`,
      'warning', '/inventory'
    );
  }

  // --- E-invoicing compliance: invoices without IRN.
  // Reporting to the IRP must happen within 30 days of generation for
  // AATO >₹10cr (5cr for historic periods); flag anything older than 5 days.
  const [[cmap]] = await pool.query('SELECT e_invoice_enabled, aggregate_turnover_crores FROM company_settings ORDER BY id LIMIT 1');
  if (cmap && (Number(cmap.e_invoice_enabled) || Number(cmap.aggregate_turnover_crores) >= 5)) {
    const [noIrn] = await pool.query(
      `SELECT i.id, i.invoice_number, i.invoice_date, i.grand_total, i.customer_name
       FROM invoices i
       WHERE i.status NOT IN ('CANCELLED') AND i.irn IS NULL
         AND DATEDIFF(CURDATE(), i.invoice_date) >= 5
       ORDER BY i.invoice_date LIMIT 25`
    );
    for (const r of noIrn) {
      await insert(
        'einvoice_missing', r.id,
        `E-invoice not generated: ${r.invoice_number}`,
        `Invoice ${r.invoice_number} (${r.customer_name}, ${inr(r.grand_total)}) from ${r.invoice_date} has no IRN yet. Report within 30 days of the invoice date.`,
        'warning', '/integration'
      );
    }
  }
// --- License & subscription reminders: expiring soon / recently expired.
  const [licenses] = await pool.query(
    `SELECT l.id, l.client_name, l.expiry_date, l.amount, l.paid_amount, p.name AS plan_name,
            DATEDIFF(l.expiry_date, CURDATE()) AS days_left
     FROM client_licenses l
     LEFT JOIN license_plans p ON p.id=l.plan_id
     WHERE l.status IN ('TRIAL','ACTIVE') AND l.expiry_date IS NOT NULL
       AND DATEDIFF(l.expiry_date, CURDATE()) BETWEEN -14 AND 30
     ORDER BY l.expiry_date ASC`
  );
  for (const r of licenses) {
    const overdueExp = r.days_left < 0;
    await insert(
      overdueExp ? 'license_expired' : 'license_expiring', r.id,
      overdueExp
        ? `License expired: ${r.client_name}`
        : `License expiring in ${r.days_left} day(s): ${r.client_name}`,
      `${r.client_name}${r.plan_name ? ' (' + r.plan_name + ')' : ''} — ${r.amount ? inr(r.amount) + (r.paid_amount ? ', paid ' + inr(r.paid_amount) : '') : 'no amount on file'}. Expiry ${r.expiry_date}.`,
      overdueExp ? 'important' : 'warning', '/licensing'
    );
  }
  // Drop reminders for licenses that no longer match (renewed / cancelled /
  // completed) so the bell never stays stale.
  const keepIds = licenses.map((r) => r.id);
  if (keepIds.length) {
    const ph = keepIds.map(() => '?').join(',');
    await pool.query(
      `DELETE FROM notifications
       WHERE type IN ('license_expiring','license_expired')
         AND (reference_id IS NULL OR reference_id NOT IN (${ph}))`,
      keepIds
    );
  } else {
    await pool.query(
      `DELETE FROM notifications
       WHERE type IN ('license_expiring','license_expired') AND reference_id IS NOT NULL`
    );
  }
}

/**
 * GET /api/notifications - sync alerts fresh, then return newest with unread count.
 */
async function list(req, res, next) {
  try {
    const pool = getPool();
    await syncAlerts(pool);
    const [rows] = await pool.query(
      `SELECT id, type, title, message, severity, link, is_read, created_at
       FROM notifications ORDER BY is_read ASC, id DESC LIMIT 30`
    );
    const [[{ unread }]] = await pool.query(
      `SELECT COUNT(*) AS unread FROM notifications WHERE is_read = 0`
    );
    res.json({ unread, notifications: rows });
  } catch (e) {
    next(e);
  }
}

/**
 * POST /api/notifications/read  { all:true }  OR  { ids:[3,5] }
 */
async function markRead(req, res, next) {
  try {
    const pool = getPool();
    const { ids, all } = req.body || {};
    if (all) {
      await pool.query(`UPDATE notifications SET is_read = 1 WHERE is_read = 0`);
    } else if (Array.isArray(ids) && ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      await pool.query(
        `UPDATE notifications SET is_read = 1 WHERE id IN (${placeholders})`,
        ids
      );
    }
    const [[{ unread }]] = await pool.query(`SELECT COUNT(*) AS unread FROM notifications WHERE is_read = 0`);
    res.json({ ok: true, unread });
  } catch (e) {
    next(e);
  }
}

module.exports = { list, markRead, syncAlerts };