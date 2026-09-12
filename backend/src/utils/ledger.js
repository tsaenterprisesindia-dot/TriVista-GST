/**
 * ledger.js - double-entry ledger core.
 *
 * Posting is voucher-based. Every voucher balances (sum debit == sum credit) and
 * is recorded once in `journal_entries` with its legs in `transactions`.
 * All functions take a `db` (promise pool OR active connection) and are safe to
 * run inside the caller's transaction (connections inherit the open transaction).
 *
 * Convention: ASSET/EQUITY-EXPENSE increase by debit, LIABILITY/INCOME/EQUITY
 * increase by credit. A credit note / sales return is a signed document, so the
 * voucher legs naturally reverse when the amounts are negative.
 */
const { round2 } = require('./gst');

const normalBalance = (type) => (type === 'ASSET' || type === 'EXPENSE' ? 'dr' : 'cr');

async function getAccount(db, code) {
  const [rows] = await db.query('SELECT * FROM accounts WHERE code=?', [code]);
  return rows[0] || null;
}

async function accountId(db, code) {
  const a = await getAccount(db, code);
  if (!a) throw new Error(`Ledger account "${code}" not found. Run the ledger migration first.`);
  return a.id;
}

/**
 * Post a balanced ledger voucher. Idempotent on voucher_no.
 */
async function postVoucher(db, opts) {
  const {
    voucher_no,
    date,
    narration,
    source = 'JOURNAL',
    ref_type = null,
    ref_id = null,
    legs = [],
    created_by = null,
  } = opts;

  if (!voucher_no) throw new Error('voucher_no is required.');
  const [ex] = await db.query('SELECT id FROM journal_entries WHERE voucher_no=?', [voucher_no]);
  if (ex.length) return { skipped: true, id: ex[0].id, voucher_no };

  if (!Array.isArray(legs) || !legs.length) throw new Error('Voucher has no ledger lines.');
  let dr = 0;
  let cr = 0;
  for (const l of legs) {
    if (!l.account_id) throw new Error('Each ledger line needs an account_id.');
    dr += Number(l.debit) || 0;
    cr += Number(l.credit) || 0;
  }
  if (Math.abs(dr - cr) > 0.01) {
    throw new Error(`Ledger entry "${voucher_no}" does not balance (Debit ${round2(dr)} vs Credit ${round2(cr)}).`);
  }

  const [ins] = await db.query(
    `INSERT INTO journal_entries (voucher_no,voucher_date,narration,source,ref_type,ref_id,created_by)
     VALUES (?,?,?,?,?,?,?)`,
    [voucher_no, date, narration || '', source, ref_type || null, ref_id || null, created_by || null]
  );
  const jid = ins.insertId;

  for (const l of legs) {
    const d = round2(Number(l.debit) || 0);
    const c = round2(Number(l.credit) || 0);
    if (d === 0 && c === 0) continue;
    await db.query(
      `INSERT INTO transactions (journal_id,voucher_no,account_id,\`date\`,debit,credit,narration,reference_type,reference_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [jid, voucher_no, l.account_id, date, d, c, narration || '', ref_type || null, ref_id || null]
    );
  }
  return { id: jid, voucher_no };
}

/**
 * Reverse an existing voucher by posting its mirror image (dr<->cr swapped).
 * Used when an invoice / purchase bill is cancelled.
 */
async function postReversal(db, { voucher_no, date, narration, created_by }) {
  const [legs] = await db.query(
    'SELECT account_id, debit, credit FROM transactions WHERE voucher_no=?',
    [voucher_no]
  );
  if (!legs.length) return { skipped: true };
  const mirrored = legs.map((l) => ({ account_id: l.account_id, debit: l.credit, credit: l.debit }));
  return postVoucher(db, {
    voucher_no: `REV-${voucher_no}`,
    date,
    narration: `${narration || 'Reversal'} (REV-${voucher_no})`,
    source: 'REVERSAL',
    legs: mirrored,
    created_by,
  });
}

// ---------------- Sales ----------------

async function postSale(db, invoice, created_by) {
  const debtorId = await accountId(db, '1300');
  const salesId = await accountId(db, '4000');
  const gstOutCgst = await accountId(db, '2100');
  const gstOutSgst = await accountId(db, '2200');
  const gstOutIgst = await accountId(db, '2300');
  const roundOffId = await accountId(db, '5600');

  const legs = [];
  const push = (id, debit, credit) => legs.push({ account_id: id, debit, credit });

  push(debtorId, Number(invoice.grand_total) || 0, 0);
  push(salesId, 0, Number(invoice.subtotal) || 0);
  push(gstOutCgst, 0, Number(invoice.cgst_total) || 0);
  push(gstOutSgst, 0, Number(invoice.sgst_total) || 0);
  push(gstOutIgst, 0, Number(invoice.igst_total) || 0);

  const dr = legs.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const cr = legs.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const diff = round2(dr - cr); // equals the round-off adjustment
  if (Math.abs(diff) > 0.005) {
    if (diff > 0) push(roundOffId, 0, diff);
    else push(roundOffId, -diff, 0);
  }

  return postVoucher(db, {
    voucher_no: `INV-${invoice.invoice_number}`,
    date: invoice.invoice_date,
    narration: `Sales ${invoice.invoice_number} - ${invoice.customer_name || ''}`.trim(),
    source: 'INVOICE',
    ref_type: 'invoice',
    ref_id: invoice.id,
    legs,
    created_by,
  });
}

async function postSalePayment(db, { invoice, amount, date, mode = 'BANK', payment_id, created_by }) {
  const cash = String(mode).toUpperCase() === 'CASH';
  return postVoucher(db, {
    voucher_no: `P-INV-${payment_id}`,
    date,
    narration: `Payment received on ${invoice.invoice_number} (${mode.toUpperCase() || 'BANK'})`,
    source: 'PAYMENT',
    ref_type: 'payment',
    ref_id: payment_id,
    legs: [
      { account_id: await accountId(db, cash ? '1000' : '1100'), debit: Number(amount) || 0, credit: 0 },
      { account_id: await accountId(db, '1300'), debit: 0, credit: Number(amount) || 0 },
    ],
    created_by,
  });
}

// ---------------- Purchases ----------------

async function postPurchase(db, bill, created_by) {
  const purchasesId = await accountId(db, '5000');
  const credId = await accountId(db, '2000');
  const inCgst = await accountId(db, '2600');
  const inSgst = await accountId(db, '2700');
  const inIgst = await accountId(db, '2800');
  const outCgst = await accountId(db, '2100');
  const outSgst = await accountId(db, '2200');
  const outIgst = await accountId(db, '2300');
  const roundOffId = await accountId(db, '5600');

  const legs = [];
  const push = (id, debit, credit) => legs.push({ account_id: id, debit, credit });

  push(purchasesId, Number(bill.subtotal) || 0, 0);
  if (Number(bill.is_rcm) === 1) {
    // Reverse charge: GST is our liability, creditor = taxable value only
    push(inCgst, Number(bill.cgst_total) || 0, 0);
    push(inSgst, Number(bill.sgst_total) || 0, 0);
    push(inIgst, Number(bill.igst_total) || 0, 0);
    push(outCgst, 0, Number(bill.cgst_total) || 0);
    push(outSgst, 0, Number(bill.sgst_total) || 0);
    push(outIgst, 0, Number(bill.igst_total) || 0);
    push(credId, 0, Number(bill.subtotal) || 0);
  } else {
    push(inCgst, Number(bill.cgst_total) || 0, 0);
    push(inSgst, Number(bill.sgst_total) || 0, 0);
    push(inIgst, Number(bill.igst_total) || 0, 0);
    push(credId, 0, Number(bill.grand_total) || 0);
  }

  const dr = legs.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const cr = legs.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const diff = round2(dr - cr);
  if (Math.abs(diff) > 0.005) {
    if (diff > 0) push(roundOffId, 0, diff);
    else push(roundOffId, -diff, 0);
  }

  return postVoucher(db, {
    voucher_no: `PB-${bill.bill_number}`,
    date: bill.bill_date,
    narration: `Purchase ${bill.bill_number} - ${bill.vendor_name || ''}`.trim(),
    source: 'PURCHASE',
    ref_type: 'purchase_bill',
    ref_id: bill.id,
    legs,
    created_by,
  });
}

async function postPurchasePayment(db, { bill, amount, date, mode = 'BANK', payment_id, created_by }) {
  const cash = String(mode).toUpperCase() === 'CASH';
  return postVoucher(db, {
    voucher_no: `P-PB-${payment_id}`,
    date,
    narration: `Payment made on ${bill.bill_number} (${mode.toUpperCase() || 'BANK'})`,
    source: 'PAYMENT',
    ref_type: 'payment',
    ref_id: payment_id,
    legs: [
      { account_id: await accountId(db, '2000'), debit: Number(amount) || 0, credit: 0 },
      { account_id: await accountId(db, cash ? '1000' : '1100'), debit: 0, credit: Number(amount) || 0 },
    ],
    created_by,
  });
}

// ---------------- Reporting ----------------

/** Chart of accounts with opening + live ledger balance. */
async function accountList(db) {
  const [rows] = await db.query(
    `SELECT a.*, IFNULL(SUM(t.debit) - SUM(t.credit),0) AS txn_balance
     FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
     GROUP BY a.id,a.code,a.name,a.type,a.parent_id,a.opening_balance,a.is_active,a.created_at
     ORDER BY a.code`
  );
  return rows.map((r) => ({
    ...r,
    balance: round2(Number(r.opening_balance) + Number(r.txn_balance)),
  }));
}

/** Per-account ledger: opening, voucher rows with running balance, closing. */
async function ledgerReport(db, { account_id, from, to }) {
  const [acct] = await db.query('SELECT * FROM accounts WHERE id=?', [account_id]);
  if (!acct.length) {
    const err = new Error('Account not found.');
    err.status = 404;
    throw err;
  }
  const account = acct[0];
  const fromDate = from || '1900-01-01';
  const toDate = to || '9999-12-31';

  const [open] = await db.query(
    'SELECT IFNULL(SUM(debit) - SUM(credit),0) AS bal FROM transactions WHERE account_id=? AND `date` < ?',
    [account_id, fromDate]
  );
  const openingBalance = round2(Number(account.opening_balance) + Number(open[0].bal));

  const [txs] = await db.query(
    `SELECT t.id,t.voucher_no,t.\`date\`,t.narration,t.debit,t.credit,
            j.source,j.ref_type,j.ref_id
     FROM transactions t LEFT JOIN journal_entries j ON j.id = t.journal_id
     WHERE t.account_id=? AND t.\`date\` BETWEEN ? AND ?
     ORDER BY t.\`date\`, t.id`,
    [account_id, fromDate, toDate]
  );

  let running = openingBalance;
  const entries = txs.map((t) => {
    running = round2(running + Number(t.debit) - Number(t.credit));
    return {
      id: t.id,
      voucher_no: t.voucher_no,
      date: t.date,
      narration: t.narration,
      debit: round2(Number(t.debit)),
      credit: round2(Number(t.credit)),
      source: t.source,
      ref_type: t.ref_type,
      ref_id: t.ref_id,
      balance: running,
    };
  });

  return {
    account,
    openingBalance,
    entries,
    closingBalance: running,
  };
}

/** Trial balance from the ledger as of a date (opening balance + postings). */
async function trialBalanceReport(db, asOf) {
  const toDate = asOf || '9999-12-31';
  const [rows] = await db.query(
    `SELECT a.id,a.code,a.name,a.type,a.opening_balance,
            IFNULL(SUM(t.debit),0) AS d, IFNULL(SUM(t.credit),0) AS c
     FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id AND t.\`date\` <= ?
     WHERE a.is_active = 1
     GROUP BY a.id,a.code,a.name,a.type,a.opening_balance
     ORDER BY a.code`,
    [toDate]
  );

  const items = rows.map((r) => {
    const net = round2(Number(r.opening_balance) + Number(r.d) - Number(r.c));
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      type: r.type,
      debit: round2(net > 0 ? net : 0),
      credit: round2(net < 0 ? -net : 0),
    };
  });

  const totals = items.reduce(
    (acc, r) => {
      acc.debit += r.debit;
      acc.credit += r.credit;
      return acc;
    },
    { debit: 0, credit: 0 }
  );
  totals.debit = round2(totals.debit);
  totals.credit = round2(totals.credit);

  return {
    asOf: toDate === '9999-12-31' ? null : toDate,
    items,
    totals,
    balanced: Math.abs(totals.debit - totals.credit) < 0.01,
  };
}

/** Profit & Loss from the ledger for a period (INCOME / EXPENSE accounts). */
async function pnlReport(db, from, to) {
  const fromDate = from || '1900-01-01';
  const toDate = to || '9999-12-31';
  const [rows] = await db.query(
    `SELECT a.id,a.code,a.name,a.type,
            IFNULL(SUM(t.debit),0) AS d, IFNULL(SUM(t.credit),0) AS c
     FROM accounts a JOIN transactions t ON t.account_id = a.id
     WHERE a.type IN ('INCOME','EXPENSE') AND t.\`date\` BETWEEN ? AND ?
     GROUP BY a.id,a.code,a.name,a.type
     ORDER BY a.code`,
    [fromDate, toDate]
  );

  const items = rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    d: round2(Number(r.d)),
    c: round2(Number(r.c)),
    balance: round2(r.type === 'INCOME' ? Number(r.c) - Number(r.d) : Number(r.d) - Number(r.c)),
  }));

  let income = 0;
  let expense = 0;
  for (const r of items) {
    if (r.type === 'INCOME') income += r.balance;
    else if (r.type === 'EXPENSE') expense += r.balance;
  }

  return {
    hasPostings: items.length > 0,
    income: round2(income),
    expense: round2(expense),
    profit: round2(income - expense),
    items,
  };
}

/** Balance sheet position as of a date (ASSET / LIABILITY / EQUITY from ledger). */
async function balanceSheetReport(db, asOf) {
  const toDate = asOf || '9999-12-31';
  const [rows] = await db.query(
    `SELECT a.id,a.code,a.name,a.type,a.opening_balance,
            IFNULL(SUM(t.debit),0) AS d, IFNULL(SUM(t.credit),0) AS c
     FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id AND t.\`date\` <= ?
     WHERE a.type IN ('ASSET','LIABILITY','EQUITY')
     GROUP BY a.id,a.code,a.name,a.type,a.opening_balance
     ORDER BY a.code`,
    [toDate]
  );

  const items = rows.map((r) => {
    const dr = Number(r.opening_balance) + Number(r.d) - Number(r.c);
    const cr = Number(r.opening_balance) + Number(r.c) - Number(r.d);
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      type: r.type,
      balance: round2(r.type === 'ASSET' ? dr : cr),
    };
  });

  const byType = {};
  for (const i of items) {
    byType[i.type] = round2((byType[i.type] || 0) + i.balance);
  }

  return { items, byType };
}

module.exports = {
  getAccount,
  accountId,
  postVoucher,
  postReversal,
  postSale,
  postSalePayment,
  postPurchase,
  postPurchasePayment,
  accountList,
  ledgerReport,
  trialBalanceReport,
  pnlReport,
  balanceSheetReport,
  normalBalance,
};