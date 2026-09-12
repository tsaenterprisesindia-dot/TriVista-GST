/**
 * mig-06-ledger.js - double-entry general ledger.
 *
 * 1. journal_entries voucher header table (+ transactions.voucher_no/journal_id).
 * 2. payments.bill_id so purchase payments link to their purchase bill.
 * 3. Ledger posting accounts (Input GST, Round Off) added to the chart if absent.
 * 4. Idempotent backfill: posts balanced vouchers for every existing sale,
 *    payment, purchase bill and purchase payment.
 */
const mysql = require("mysql2/promise");
const { postSale, postSalePayment, postPurchase, postPurchasePayment, postVoucher, accountId } = require("../src/utils/ledger");

const DB = { host: "localhost", port: 3306, user: "root", password: "", database: "triveni_gst_erp", multipleStatements: true };

(async () => {
  const c = await mysql.createConnection(Object.assign({}, DB, { multipleStatements: false }));

  // ---- Transactions: attach to vouchers ----
  const [jeCols] = await c.query("SHOW COLUMNS FROM transactions LIKE 'journal_id'");
  if (!jeCols.length) {
    await c.query("ALTER TABLE transactions ADD COLUMN journal_id INT UNSIGNED DEFAULT NULL AFTER account_id, ADD KEY idx_txn_journal (journal_id)");
    console.log("added transactions.journal_id");
  } else {
    console.log("transactions.journal_id already present");
  }
  const [vnCols] = await c.query("SHOW COLUMNS FROM transactions LIKE 'voucher_no'");
  if (!vnCols.length) {
    await c.query("ALTER TABLE transactions ADD COLUMN voucher_no VARCHAR(60) DEFAULT NULL AFTER journal_id, ADD KEY idx_txn_voucher (voucher_no)");
    console.log("added transactions.voucher_no");
  } else {
    console.log("transactions.voucher_no already present");
  }

  // ---- Journal entries (voucher header) ----
  await c.query(`CREATE TABLE IF NOT EXISTS journal_entries (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    voucher_no VARCHAR(60) NOT NULL,
    voucher_date DATE NOT NULL,
    narration VARCHAR(255) DEFAULT NULL,
    source ENUM('JOURNAL','INVOICE','PURCHASE','PAYMENT','REVERSAL','OPENING') NOT NULL DEFAULT 'JOURNAL',
    ref_type VARCHAR(40) DEFAULT NULL,
    ref_id INT UNSIGNED DEFAULT NULL,
    status ENUM('POSTED','VOID') NOT NULL DEFAULT 'POSTED',
    created_by INT UNSIGNED DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_voucher_no (voucher_no),
    KEY idx_je_date (voucher_date),
    KEY idx_je_ref (ref_type, ref_id)
  ) ENGINE=InnoDB`);
  console.log("journal_entries table ready");

  // ---- Owners (auto) ----
  await c.query("ALTER TABLE transactions ADD CONSTRAINT fk_txn_journal FOREIGN KEY (journal_id) REFERENCES journal_entries(id) ON DELETE SET NULL");
  console.log("transactions.journal_id FK added");

  // ---- Payments link to purchase bill ----
  const [billCols] = await c.query("SHOW COLUMNS FROM payments LIKE 'bill_id'");
  if (!billCols.length) {
    await c.query("ALTER TABLE payments ADD COLUMN bill_id INT UNSIGNED DEFAULT NULL AFTER invoice_id, ADD KEY idx_pay_bill (bill_id)");
    console.log("added payments.bill_id");
  } else {
    console.log("payments.bill_id already present");
  }
  await c.query("ALTER TABLE payments ADD CONSTRAINT fk_pay_bill FOREIGN KEY (bill_id) REFERENCES purchase_bills(id) ON DELETE SET NULL");
  console.log("payments.bill_id FK added");

  // Backfill purchase payments where bill_id missing, matched via the payment note
  const [orphanPayments] = await c.query(
    `SELECT p.id, p.note FROM payments p
     WHERE p.invoice_id IS NULL AND p.bill_id IS NULL AND p.note LIKE 'Payment for PB-%'`
  );
  for (const p of orphanPayments) {
    const m = /Payment for (PB-[0-9]+)/.exec(p.note || '');
    if (!m) continue;
    const [bills] = await c.query("SELECT id FROM purchase_bills WHERE bill_number=?", [m[1]]);
    if (!bills.length) continue;
    await c.query("UPDATE payments SET bill_id=? WHERE id=?", [bills[0].id, p.id]);
  }
  console.log(`backfilled ${orphanPayments.length} purchase payment link(s)`);

  // ---- Ledger posting accounts ----
  const accs = [
    ["2600", "Input CGST Credit", "ASSET"],
    ["2700", "Input SGST Credit", "ASSET"],
    ["2800", "Input IGST Credit", "ASSET"],
    ["5600", "Round Off", "EXPENSE"],
  ];
  for (const [code, name, type] of accs) {
    await c.query("INSERT IGNORE INTO accounts (code,name,type) VALUES (?,?,?)", [code, name, type]);
  }
  console.log("ledger accounts ensured");

  // ---- Idempotent backfill of existing documents ----
  const [invoices] = await c.query("SELECT * FROM invoices WHERE status NOT IN ('CANCELLED')");
  for (const inv of invoices) {
    await postSale(c, inv, null);
  }
  console.log(`posted ${invoices.length} sales voucher(s)`);

  const [salePays] = await c.query(
    `SELECT p.*, i.invoice_number, i.customer_name FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     WHERE i.status NOT IN ('CANCELLED')`
  );
  for (const p of salePays) {
    await postSalePayment(c, {
      invoice: { invoice_number: p.invoice_number },
      amount: p.amount,
      date: p.date,
      mode: p.mode,
      payment_id: p.id,
      created_by: p.created_by,
    });
  }
  console.log(`posted ${salePays.length} sales payment voucher(s)`);

  const [bills] = await c.query("SELECT * FROM purchase_bills WHERE status NOT IN ('CANCELLED')");
  for (const bill of bills) {
    await postPurchase(c, bill, null);
  }
  console.log(`posted ${bills.length} purchase voucher(s)`);

  const [purPays] = await c.query(
    `SELECT p.*, b.bill_number FROM payments p
     JOIN purchase_bills b ON b.id = p.bill_id
     WHERE b.status NOT IN ('CANCELLED')`
  );
  for (const p of purPays) {
    await postPurchasePayment(c, {
      bill: { bill_number: p.bill_number },
      amount: p.amount,
      date: p.date,
      mode: p.mode,
      payment_id: p.id,
      created_by: p.created_by,
    });
  }
  console.log(`posted ${purPays.length} purchase payment voucher(s)`);

  await c.end();
  console.log("MIG OK");
})().catch((e) => { console.error(e.message); process.exit(1); });