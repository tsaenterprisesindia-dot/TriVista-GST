const crypto = require('crypto');
const { getPool } = require('../db');
const { round2 } = require('../utils/gst');

const AI_PROVIDERS = {
  OPENAI: 'https://api.openai.com/v1/chat/completions',
  GEMINI: 'https://generativelanguage.googleapis.com',
  AZURE: '',
};

/**
 * Get AI settings decrypted.
 */
async function getAiSettings(pool) {
  const [rows] = await pool.query('SELECT * FROM ai_settings ORDER BY id LIMIT 1');
  return rows[0] || null;
}

function decryptKey(enc) {
  if (!enc) return null;
  if (!enc.startsWith('enc:')) return enc;
  const secret = process.env.CRYPTO_SECRET || 'triveni-default-secret-2026';
  const [ivB64, data] = enc.slice(4).split(':');
  try {
    const iv = Buffer.from(ivB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(secret.padEnd(32).slice(0, 32)), iv);
    let out = decipher.update(Buffer.from(data, 'base64'), 'buffer', 'utf8');
    out += decipher.final('utf8');
    return out;
  } catch {
    return null;
  }
}

function encryptKey(value) {
  const secret = process.env.CRYPTO_SECRET || 'triveni-default-secret-2026';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(secret.padEnd(32).slice(0, 32)), iv);
  let out = cipher.update(value, 'utf8', 'base64');
  out += cipher.final('base64');
  return `enc:${iv.toString('base64')}:${out}`;
}

/**
 * Rule-based business insights (no API key required).
 */
async function insights(req, res, next) {
  try {
    const pool = getPool();
    const t = new Date().toISOString().slice(0, 10);
    const monthStart = t.slice(0, 8) + '01';

    const [sales] = await pool.query(
      `SELECT IFNULL(SUM(grand_total),0) AS m FROM invoices
       WHERE invoice_date BETWEEN ? AND ? AND status NOT IN ('CANCELLED')`,
      [monthStart, t]
    );
    const [prevMonth] = await pool.query(
      `SELECT IFNULL(SUM(grand_total),0) AS m FROM invoices
       WHERE DATE_FORMAT(invoice_date,'%Y-%m') = DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH),'%Y-%m')
         AND status NOT IN ('CANCELLED')`
    );
    const [topProduct] = await pool.query(
      `SELECT ii.item_name, SUM(ii.quantity) AS qty, SUM(ii.taxable_value) AS val
       FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
       WHERE i.invoice_date BETWEEN ? AND ? AND i.status NOT IN ('CANCELLED')
       GROUP BY ii.item_name ORDER BY val DESC LIMIT 1`,
      [monthStart, t]
    );
    const [slow] = await pool.query(
      `SELECT p.name, IFNULL(SUM(sm.quantity),0) AS total_in FROM products p
       LEFT JOIN stock_movements sm ON sm.product_id=p.id AND sm.type='IN' AND sm.created_at >= ?
       WHERE p.is_service=0 GROUP BY p.id,p.name ORDER BY total_in ASC LIMIT 3`,
      [monthStart]
    );
    const [overdue] = await pool.query(
      `SELECT COUNT(*) AS n, IFNULL(SUM(balance_due),0) AS amt FROM invoices
       WHERE status IN ('PENDING','PARTIAL') AND due_date < CURDATE()`
    );
    const [hsnCount] = await pool.query('SELECT COUNT(*) AS n FROM hsn_sac_codes');

    const growth = prevMonth[0].m > 0 ? round2(((sales[0].m - prevMonth[0].m) / prevMonth[0].m) * 100) : 0;
    const suggestions = [];
    if (sales[0].m > 0) {
      suggestions.push(
        growth >= 0
          ? `Sales grew ${growth}% vs last month. Consider stocking up on your top mover to avoid stock-outs.`
          : `Sales are down ${Math.abs(growth)}% vs last month. Review pricing/promotions on slow movers.`
      );
    } else {
      suggestions.push('No sales this month yet. Generate your first invoice to see insights here.');
    }
    if (topProduct[0] && topProduct[0].val > 0) {
      suggestions.push(`Most valuable product: ${topProduct[0].item_name} (â‚¹${Math.round(topProduct[0].val)}).`);
    }
    if (overdue[0].n > 0) {
      suggestions.push(`Collect ${overdue[0].n} overdue invoice(s) totalling â‚¹${Math.round(overdue[0].amt)}.`);
    }
    suggestions.push(`${hsnCount[0].n} HSN/SAC codes available in master data.`);

    res.json({
      rulesActive: true,
      summary: {
        monthSales: sales[0].m,
        growth,
        topProduct: topProduct[0] || null,
        slowMovers: slow,
        overdue,
      },
      suggestions,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * Chat endpoint: uses configured LLM if enabled, else rule-based response.
 */
async function chat(req, res, next) {
  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message is required.' });

    const pool = getPool();
    const settings = await getAiSettings(pool);

    // If provider configured + enabled, call it
    if (settings && settings.is_enabled && settings.api_key_encrypted) {
      const apiKey = decryptKey(settings.api_key_encrypted);
      if (apiKey) {
        try {
          const ans = await callLLM(settings, apiKey, message);
          return res.json({ mode: settings.provider, answer: ans, rulesActive: false });
        } catch (err) {
          // fall through to rule-based on provider error
          const r = await rulesAnswer(pool, message);
          return res.json({
            mode: 'RULES',
            intent: r.intent,
            answer: `LLM provider error (${err.message}). Using the free built-in assistant.\n\n${r.answer}`,
            rulesActive: true,
          });
        }
      }
    }
    const r = await rulesAnswer(pool, message);
    res.json({ mode: 'RULES', intent: r.intent, answer: r.answer, rulesActive: true });
  } catch (e) {
    next(e);
  }
}

const TODAY = () => new Date().toISOString().slice(0, 10);
const fmtINR = (n) => 'â‚¹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const fmtAmt = (n) => (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function pickPeriod(m) {
  const t = TODAY();
  if (/\btoday\b/.test(m)) return { label: 'today', f: t, t };
  if (/\byesterday\b/.test(m)) {
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    return { label: 'yesterday', f: y, t: y };
  }
  if (/\blast\s+month\b/.test(m)) {
    const now = new Date();
    const f = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
    const te = new Date(now.getFullYear(), now.getMonth(), 0);
    return { label: 'last month', f, t: te.toISOString().slice(0, 10) };
  }
  if (/7\s*days|this\s*week/.test(m)) {
    const f = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    return { label: 'last 7 days', f, t };
  }
  if (/30\s*days|this\s*month/.test(m)) {
    const f = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    return { label: 'this month (approx 30 days)', f, t };
  }
  return { label: 'all time', all: true };
}

function periodClause(p, col) {
  if (p?.all) return '';
  return ` AND ${col || 'DATE(created_at)'} BETWEEN '${p.f}' AND '${p.t}'`;
}

async function rulesAnswer(pool, message) {
  const m = String(message || '').toLowerCase().replace(/[?.!,]+/g, ' ').replace(/\s+/g, ' ').trim();
  const p = pickPeriod(m);
  const rng = p.all ? 'all time' : p.label;

  // ---- Greeting ----
  if (/^(hi|hello|hey|namaste|good\s*(morning|evening|afternoon))\b/.test(m)) {
    return {
      intent: 'greeting',
      answer: `Hello! I'm the free built-in AI assistant of TriVista GST. Ask me about sales, GST rates, stock, receivables, invoices, customers, purchases or profit â€” I read your actual data and answer instantly. Try: "Total sales", "GST rates", "Low stock", "Receivables", "Top product".`,
    };
  }

  // ---- Help / commands ----
  if (/(help|what can you|commands|options)/.test(m)) {
    return {
      intent: 'help',
      answer: `I answer questions about your business from the database (no internet, no API key needed):
â€¢ Sales: "Total sales this month", "Sales today", "GST collected"
â€¢ GST: "GST rates", "GST rate for 5%", "HSN codes"
â€¢ Stock: "Stock status", "Low stock", "Stock value"
â€¢ Money: "Receivables", "Overdue invoices", "Payments received"
â€¢ Products/customers: "Top product", "Top customers"
â€¢ Purchases: "Purchases this month", "Bills pending"
â€¢ Summary: "Profit summary", "Recent invoices"
Try any of these in plain English.`,
    };
  }

  // ---- GST collected (tax totals from sales) ----
  if (/(gst|tax)/.test(m) && /(collect|output|input|payable|paid|total\s*gst|\bgst\s*amount)/.test(m)) {
    const [r] = await pool.query(
      `SELECT IFNULL(SUM(cgst_total),0) c, IFNULL(SUM(sgst_total),0) s, IFNULL(SUM(igst_total),0) i,
              IFNULL(SUM(utgst_total),0) u, IFNULL(SUM(tax_total),0) tax, COUNT(*) n
       FROM invoices WHERE status NOT IN ('CANCELLED')${periodClause(p, 'invoice_date')}`,
      p.all ? [] : [p.f, p.t]
    );
    return {
      intent: 'gst',
      answer: `GST collected on ${r[0].n} invoice(s) (${rng}):
â€¢ CGST: ${fmtINR(r[0].c)}  â€¢ SGST: ${fmtINR(r[0].s)}  â€¢ IGST: ${fmtINR(r[0].i)}
â€¢ UTGST: ${fmtINR(r[0].u)}
â€¢ Total GST: ${fmtINR(r[0].tax)}`,
    };
  }

  // ---- GST rates / HSN lookup ----
  if (/(gst|tax|rate)/.test(m) && /(rate|percent|%|gst\s*rate)/.test(m)) {
    const pct = m.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pct) {
      const [rows] = await pool.query(
        `SELECT code, description, gst_rate, type FROM hsn_sac_codes WHERE gst_rate=? ORDER BY code LIMIT 12`,
        [Number(pct[1])]
      );
      if (!rows.length) return { intent: 'gst', answer: `No HSN/SAC codes found at ${pct[1]}% in your master data.` };
      return {
        intent: 'gst',
        answer: `HSN/SAC codes at ${pct[1]}%:\n` + rows.map((r) => `â€¢ ${r.code} (${r.type || 'â€”'}) ${r.description || ''}`).join('\n'),
      };
    }
    const [dist] = await pool.query(`SELECT gst_rate, COUNT(*) n FROM hsn_sac_codes GROUP BY gst_rate ORDER BY gst_rate`);
    const [sample] = await pool.query(`SELECT code, description, gst_rate FROM hsn_sac_codes ORDER BY code LIMIT 8`);
    const distTxt = dist.map((d) => `${fmtAmt(d.gst_rate)}% (${d.n})`).join(', ');
    return {
      intent: 'gst',
      answer: `GST rates in your HSN/SAC master: ${distTxt}.\n\nSamples:\n` + sample.map((r) => `â€¢ ${r.code} ${r.gst_rate}% â€” ${r.description || ''}`).join('\n'),
    };
  }

  // ---- HSN / SAC codes ----
  if (/(hsn|sac)/.test(m)) {
    const [rows] = await pool.query(`SELECT code, type, gst_rate, description FROM hsn_sac_codes ORDER BY code LIMIT 12`);
    if (!rows.length) return { intent: 'hsn', answer: 'No HSN/SAC codes in master data yet. Add them in Products or HSN master.' };
    return { intent: 'hsn', answer: 'HSN/SAC codes in your master:\n' + rows.map((r) => `â€¢ ${r.code} (${r.type || 'â€”'}) ${r.gst_rate}% â€” ${r.description || ''}`).join('\n') };
  }

  // ---- Top product / best seller ----
  if (/(top|best|popular|fastest|mover|max)/.test(m) && /(product|item|selling)/.test(m)) {
    const [rows] = await pool.query(
      `SELECT ii.item_name, SUM(ii.quantity) qty, SUM(ii.taxable_value) val
       FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
       WHERE i.status NOT IN ('CANCELLED')${periodClause(p, 'invoice_date')}
       GROUP BY ii.item_name ORDER BY val DESC LIMIT 3`,
      p.all ? [] : [p.f, p.t]
    );
    if (!rows.length) return { intent: 'top-product', answer: `No sales found for ${rng}.` };
    return { intent: 'top-product', answer: `Top products (${rng}):\n` + rows.map((r, i) => `â€¢ ${i + 1}. ${r.item_name} â€” ${fmtAmt(r.qty)} units, ${fmtINR(r.val)}`).join('\n') };
  }

  // ---- Sales / revenue ----
  if (/(\bsale|\bsold|revenue|turnover|income|billing|sales)/.test(m)) {
    const [r] = await pool.query(
      `SELECT IFNULL(SUM(grand_total),0) total, COUNT(*) n,
              IFNULL(SUM(paid_amount),0) paid, IFNULL(SUM(igst_total),0) ig
       FROM invoices WHERE status NOT IN ('CANCELLED')${periodClause(p, 'invoice_date')}`,
      p.all ? [] : [p.f, p.t]
    );
    const [r2] = await pool.query(
      `SELECT IFNULL(SUM(grand_total),0) c FROM invoices
       WHERE status NOT IN ('CANCELLED') AND is_interstate=0${periodClause(p, 'invoice_date')}`,
      p.all ? [] : [p.f, p.t]
    );
    return {
      intent: 'sales',
      answer: `Sales (${rng}): ${fmtINR(r[0].total)} across ${r[0].n} invoice(s).\nâ€¢ Collected: ${fmtINR(r[0].paid)}  â€¢ Uncollected: ${fmtINR(r[0].total - r[0].paid)}\nâ€¢ Intra-state: ${fmtINR(r2[0].c)}  â€¢ Interstate: ${fmtINR(r[0].ig ? r[0].total - r2[0].c : r[0].total - r2[0].c)}`,
    };
  }

  // ---- Customers ----
  if (/(customer|client|party)/.test(m)) {
    if (/(balance|outstanding|due|credit)/.test(m)) {
      const [r] = await pool.query(
        `SELECT COUNT(*) n, IFNULL(SUM(outstanding_balance),0) amt FROM customers WHERE is_active=1`
      );
      return { intent: 'customers', answer: `${r[0].n} active customer(s) with a total outstanding balance of ${fmtINR(r[0].amt)}.` };
    }
    const [r] = await pool.query(
      `SELECT c.name, IFNULL(SUM(i.grand_total),0) v, COUNT(i.id) n
       FROM customers c LEFT JOIN invoices i ON i.customer_id=c.id AND i.status NOT IN ('CANCELLED')${periodClause(p, 'invoice_date')}
       GROUP BY c.id, c.name ORDER BY v DESC LIMIT 5`
    );
    const [cnt] = await pool.query(`SELECT COUNT(*) n FROM customers WHERE is_active=1`);
    const list = r.filter((x) => x.n > 0);
    return {
      intent: 'customers',
      answer: `${cnt[0].n} active customer(s). Top by sales (${rng}):\n` +
        (list.length ? list.map((c, i) => `â€¢ ${i + 1}. ${c.name} â€” ${fmtINR(c.v)} (${c.n} invoice${c.n > 1 ? 's' : ''})`).join('\n') : 'No sales yet.'),
    };
  }

  // ---- Receivables / dues ----
  if (/(receivable|outstanding|pending|due|unpaid|collect|owe|credit)/.test(m)) {
    const [r] = await pool.query(
      `SELECT COUNT(*) n, IFNULL(SUM(balance_due),0) amt FROM invoices WHERE status IN ('PENDING','PARTIAL')`
    );
    const [ov] = await pool.query(
      `SELECT COUNT(*) n, IFNULL(SUM(balance_due),0) amt FROM invoices
       WHERE status IN ('PENDING','PARTIAL') AND due_date IS NOT NULL AND due_date < CURDATE()`
    );
    const [top] = await pool.query(
      `SELECT invoice_number, customer_name, due_date, balance_due FROM invoices
       WHERE status IN ('PENDING','PARTIAL') ORDER BY balance_due DESC LIMIT 5`
    );
    return {
      intent: 'receivables',
      answer: `Outstanding receivables: ${fmtINR(r[0].amt)} across ${r[0].n} invoice(s).\nâ€¢ Overdue: ${fmtINR(ov[0].amt)} (${ov[0].n})\n\nLargest dues:\n` +
        (top.length ? top.map((t) => `â€¢ ${t.invoice_number} ${t.customer_name || ''} â€” ${fmtINR(t.balance_due)}${t.due_date ? ` (due ${t.due_date})` : ''}`).join('\n') : 'No pending invoices.'),
    };
  }

  // ---- Recent / count invoices ----
  if (/(invoice|bill)/.test(m)) {
    if (/(count|how many|total\s*invoice)/.test(m)) {
      const [r] = await pool.query(
        `SELECT COUNT(*) n, SUM(status='CANCELLED') c FROM invoices WHERE 1=1${periodClause(p, 'invoice_date')}`,
        p.all ? [] : [p.f, p.t]
      );
      return { intent: 'invoices', answer: `${r[0].n} invoice(s) in total (${rng}), of which ${r[0].c} cancelled.` };
    }
    if (/(status)/.test(m)) {
      const [rows] = await pool.query(`SELECT status, COUNT(*) n FROM invoices GROUP BY status ORDER BY n DESC`);
      return { intent: 'invoices', answer: 'Invoices by status:\n' + rows.map((x) => `â€¢ ${x.status}: ${x.n}`).join('\n') };
    }
    const [rows] = await pool.query(`SELECT invoice_number, customer_name, invoice_date, status, grand_total FROM invoices ORDER BY created_at DESC LIMIT 5`);
    return { intent: 'invoices', answer: 'Recent invoices:\n' + rows.map((x) => `â€¢ ${x.invoice_number} ${x.customer_name || ''} â€” ${fmtINR(x.grand_total)} [${x.status}] ${x.invoice_date}`).join('\n') };
  }

  // ---- Purchases / expenses ----
  if (/(purchase|expense|bill|vendor)/.test(m) && !/(invoice)/.test(m)) {
    const [r] = await pool.query(
      `SELECT IFNULL(SUM(grand_total),0) total, COUNT(*) n FROM purchase_bills WHERE status NOT IN ('CANCELLED')${periodClause(p, 'bill_date')}`,
      p.all ? [] : [p.f, p.t]
    );
    const [pay] = await pool.query(`SELECT IFNULL(SUM(balance_due),0) amt, COUNT(*) n FROM purchase_bills WHERE status IN ('PENDING','PARTIAL')`);
    return { intent: 'purchases', answer: `Purchases (${rng}): ${fmtINR(r[0].total)} across ${r[0].n} bill(s).\nâ€¢ Payable pending: ${fmtINR(pay[0].amt)} (${pay[0].n} bills)` };
  }

  // ---- Stock / inventory ----
  if (/(stock|inventory|reorder|reorder\s*level|low|level)/.test(m)) {
    const [r] = await pool.query(
      `SELECT p.name, p.unit, p.min_stock,
              IFNULL(SUM(CASE WHEN sm.type='IN' THEN sm.quantity WHEN sm.type='OUT' THEN -sm.quantity ELSE sm.quantity END),0) AS oh,
              ROUND(IFNULL(SUM(CASE WHEN sm.type='IN' THEN sm.quantity WHEN sm.type='OUT' THEN -sm.quantity ELSE sm.quantity END),0) * p.purchase_price,2) AS val
       FROM products p LEFT JOIN stock_movements sm ON sm.product_id=p.id
       WHERE p.is_service=0 GROUP BY p.id,p.name,p.unit,p.min_stock,p.purchase_price`
    );
    const low = r.filter((x) => Number(x.oh) <= Number(x.min_stock || 0));
    const totalVal = r.reduce((s, x) => s + Number(x.val || 0), 0);
    let ans = `Stock value at purchase price: ${fmtINR(totalVal)} (${r.length} products tracked).\n`;
    if (/low|reorder|stock\s*status/.test(m)) {
      if (!low.length) ans += '\nNo product is below its reorder level â€” stock looks healthy.';
      else ans += `\n${low.length} product(s) at/below reorder level:\n` + low.slice(0, 8).map((x) => `â€¢ ${x.name}: ${fmtAmt(x.oh)} ${x.unit || ''} (min ${fmtAmt(x.min_stock || 0)})`).join('\n');
    }
    return { intent: 'stock', answer: ans };
  }

  // ---- Payments received ----
  if (/(payment|received|collected|money received)/.test(m)) {
    const [r] = await pool.query(
      `SELECT IFNULL(SUM(amount),0) total, COUNT(*) n FROM payments WHERE 1=1${periodClause(p)}`,
      p.all ? [] : [p.f, p.t]
    );
    return { intent: 'payments', answer: `Payments received (${rng}): ${fmtINR(r[0].total)} across ${r[0].n} transaction(s).` };
  }

  // ---- Profit / summary ----
  if (/(profit|pnl|summary|performance|business\s*health)/.test(m)) {
    const [s] = await pool.query(
      `SELECT IFNULL(SUM(grand_total),0) total FROM invoices WHERE status NOT IN ('CANCELLED')${periodClause(p, 'invoice_date')}`,
      p.all ? [] : [p.f, p.t]
    );
    const [b] = await pool.query(
      `SELECT IFNULL(SUM(grand_total),0) total FROM purchase_bills WHERE status NOT IN ('CANCELLED')${periodClause(p, 'bill_date')}`,
      p.all ? [] : [p.f, p.t]
    );
    const gross = s[0].total - b[0].total;
    return {
      intent: 'summary',
      answer: `Trading summary (${rng}):\nâ€¢ Sales: ${fmtINR(s[0].total)}\nâ€¢ Purchases: ${fmtINR(b[0].total)}\nâ€¢ Trading surplus (sales âˆ’ purchases): ${fmtINR(gross)}\n\nFor the full P&L with all expense heads, open Accounting â†’ Profit & Loss.`,
    };
  }

  // ---- e-Invoice / IRN / e-Way ----
  if (/(e-invoice|einvoice|irn|e-way|eway|ewaybill)/.test(m)) {
    const [rows] = await pool.query(`SELECT status, COUNT(*) n FROM einvoice_logs GROUP BY status`);
    const [gen] = await pool.query(`SELECT COUNT(*) n FROM invoices WHERE irn IS NOT NULL AND irn <> ''`);
    return {
      intent: 'einvoice',
      answer: `e-Invoice activity:\n` + (rows.length ? rows.map((x) => `â€¢ ${x.status}: ${x.n}`).join('\n') : 'â€¢ No e-invoice attempts yet.') +
        `\n${gen[0].n} invoice(s) have an IRN.`,
    };
  }

  // ---- Fallback ----
  return {
    intent: 'unclear',
    answer: `I didn't understand that. I'm the free built-in assistant and can answer from your data: sales, GST rates, HSN/SAC codes, stock & reorder status, receivables & overdue, top products/customers, purchases, payments, invoice counts and profit summary.\n\nTry: "Total sales this month", "GST rates", "Low stock", "Receivables", "Top product", "Recent invoices".`,
  };
}

async function callLLM(settings, apiKey, message) {
  const endpoint = settings.endpoint || AI_PROVIDERS[settings.provider] || '';
  const model = settings.model || (settings.provider === 'OPENAI' ? 'gpt-4o-mini' : settings.provider === 'GEMINI' ? 'gemini-1.5-flash' : 'default');
  if (settings.provider === 'GEMINI') {
    const url = `${endpoint}/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: message }] }] }),
    });
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from Gemini.';
  }
  // OPENAI / AZURE compatible
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are the assistant for TriVista GST, an Indian GST billing software. Answer concisely about GST, bookkeeping, e-invoice, inventory.' },
        { role: 'user', content: message },
      ],
    }),
  });
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || 'No response from provider.';
}

// ---------------- Settings management ----------------
async function getSettings(req, res, next) {
  try {
    const pool = getPool();
    const settings = await getAiSettings(pool);
    if (!settings) return res.json({ provider: 'NONE', is_enabled: false });
    res.json({
      provider: settings.provider,
      model: settings.model,
      endpoint: settings.endpoint,
      is_enabled: !!settings.is_enabled,
      key_configured: !!settings.api_key_encrypted,
    });
  } catch (e) {
    next(e);
  }
}

async function saveSettings(req, res, next) {
  try {
    const { provider, model, endpoint, api_key, is_enabled } = req.body || {};
    const pool = getPool();
    const enc = api_key ? encryptKey(api_key) : null;
    const existing = await getAiSettings(pool);
    if (!existing) {
      await pool.query(
        `INSERT INTO ai_settings (provider,model,endpoint,api_key_encrypted,is_enabled)
         VALUES (?,?,?,?,?)`,
        [provider || 'NONE', model || null, endpoint || null, enc, is_enabled ? 1 : 0]
      );
    } else {
      await pool.query(
        `UPDATE ai_settings SET provider=COALESCE(?,provider), model=COALESCE(?,model), endpoint=COALESCE(?,endpoint),
         api_key_encrypted=COALESCE(?,api_key_encrypted), is_enabled=? WHERE id=?`,
        [provider || null, model || null, endpoint || null, enc, is_enabled ? 1 : 0, existing.id]
      );
    }
    res.json({ message: 'AI settings saved.' });
  } catch (e) {
    next(e);
  }
}

// ---------------- Free entry helper (make entries correct) ----------------
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

async function validate(req, res, next) {
  try {
    const body = req.body || {};
    const pool = getPool();
    const issues = [];
    const suggestions = [];

    const [companyRows] = await pool.query(
      `SELECT state_code, gstin FROM company_settings ORDER BY id LIMIT 1`
    );
    const companyState = String(companyRows[0]?.state_code || '29');
    const companyGSTIN = companyRows[0]?.gstin || '';

    // ---- Customer ----
    const customerId = body.customer_id;
    if (!customerId) {
      issues.push({ level: 'error', field: 'customer_id', message: 'Select a customer before saving.' });
    } else {
      const [cust] = await pool.query(
        `SELECT id, name, gstin, state_code, outstanding_balance FROM customers WHERE id=?`,
        [customerId]
      );
      if (!cust[0]) {
        issues.push({ level: 'error', field: 'customer_id', message: `Customer #${customerId} not found.` });
      } else {
        const c = cust[0];
        if (c.gstin) {
          if (!GSTIN_RE.test(c.gstin)) {
            issues.push({
              level: 'error',
              field: 'customer_gstin',
              message: `GSTIN "${c.gstin}" for "${c.name}" is not a valid 15-character GSTIN. Fix it in Customers to avoid rejection in GSTR-1.`,
            });
            suggestions.push(`Valid GSTIN format: 2-digit state + 10-char PAN + entity code + 'Z' + check digit (e.g. 29ABCDE1234F1Z5).`);
          }
        } else {
          suggestions.push(`"${c.name}" has no GSTIN â€” invoice will be B2C. For a B2B (registered) sale, add the GSTIN in Customers.`);
        }
        const supply = String(body.place_of_supply || c.state_code || companyState);
        const interstate = supply !== companyState;
        const declared = !!body.is_interstate;
        if (declared !== interstate) {
          issues.push({
            level: 'warn',
            field: 'place_of_supply',
            message: `Place of supply ${supply} vs your state ${companyState}: this is ${interstate ? 'INTERSTATE' : 'INTRASTATE'}, but the flag says ${declared ? 'INTERSTATE' : 'INTRASTATE'}. It will be taxed as ${interstate ? 'IGST' : 'CGST + SGST'}.`,
          });
        }
        if (Number(c.outstanding_balance || 0) > 0) {
          suggestions.push(`"${c.name}" already owes ${fmtINR(c.outstanding_balance)} â€” collect before extending more credit.`);
        }
      }
    }

    // ---- Date ----
    if (body.invoice_date) {
      if (isNaN(new Date(body.invoice_date))) {
        issues.push({ level: 'error', field: 'invoice_date', message: 'Invoice date is invalid.' });
      }
    } else {
      issues.push({ level: 'error', field: 'invoice_date', message: 'Invoice date is required.' });
    }

    // ---- Items ----
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      issues.push({ level: 'error', field: 'items', message: 'Add at least one product line.' });
    }

    const [stockRows] = await pool.query(
      `SELECT product_id, IFNULL(SUM(CASE WHEN type='IN' THEN quantity WHEN type='OUT' THEN -quantity ELSE quantity END),0) AS oh
       FROM stock_movements WHERE type IN ('IN','OUT') GROUP BY product_id`
    );
    const stockMap = {};
    stockRows.forEach((s) => (stockMap[s.product_id] = Number(s.oh || 0)));

    const [productRows] = await pool.query(
      `SELECT id, name, hsn_code, gst_rate FROM products WHERE is_service=0`
    );
    const prodMap = {};
    productRows.forEach((p) => (prodMap[p.id] = p));

    let subtotal = 0;
    let tax = 0;
    items.forEach((it, i) => {
      const qty = Number(it.quantity || 0);
      const price = Number(it.unit_price || 0);
      const disc = Number(it.discount || 0);
      const rate = Number(it.gst_rate || 0);
      const name = it.item_name || `Item ${i + 1}`;

      if (!(qty > 0)) issues.push({ level: 'error', field: `items[${i}].quantity`, message: `${name}: quantity must be greater than 0.` });
      if (!(price > 0)) issues.push({ level: 'error', field: `items[${i}].unit_price`, message: `${name}: rate must be greater than 0.` });
      if (disc > qty * price) issues.push({ level: 'warn', field: `items[${i}].discount`, message: `${name}: discount exceeds the line value.` });

      const taxable = qty * price - disc;
      subtotal += taxable;
      tax += rate > 0 ? (taxable * rate) / 100 : 0;

      if (it.product_id && prodMap[it.product_id]) {
        const p = prodMap[it.product_id];
        if (Math.abs(Number(p.gst_rate) - rate) > 0.001) {
          issues.push({
            level: 'warn',
            field: `items[${i}].gst_rate`,
            message: `${p.name}: entered GST ${rate}% differs from product master (${p.gst_rate}%). The master rate will change your tax total.`,
          });
        }
        if (p.hsn_code && it.hsn_code && String(p.hsn_code) !== String(it.hsn_code)) {
          issues.push({ level: 'warn', field: `items[${i}].hsn_code`, message: `${p.name}: entered HSN ${it.hsn_code} differs from product master (${p.hsn_code}).` });
        }
        const oh = stockMap[it.product_id];
        if (oh !== undefined && qty > oh) {
          issues.push({ level: 'warn', field: `items[${i}].quantity`, message: `${p.name}: only ${fmtAmt(oh)} in stock but ${fmtAmt(qty)} billed â€” confirm stock before saving.` });
        }
      } else if (!it.product_id) {
        issues.push({ level: 'warn', field: `items[${i}].product_id`, message: `${name}: no linked product â€” HSN/GST cannot be verified against master data.` });
      }
      if (!it.hsn_code) {
        issues.push({ level: 'warn', field: `items[${i}].hsn_code`, message: `${name}: missing HSN code. A 4+ digit HSN is expected on GST invoices.` });
      }
    });

    // ---- Money ----
    const grand = r2(subtotal + tax);
    const paid = Number(body.paid_amount || 0);
    if (grand <= 0) issues.push({ level: 'error', field: 'grand_total', message: 'Invoice total is zero â€” add products or rates.' });
    if (paid > grand) {
      issues.push({ level: 'error', field: 'paid_amount', message: `Paid amount ${fmtINR(paid)} exceeds grand total ${fmtINR(grand)}.` });
    } else if (paid === 0 && body.payment_mode && body.payment_mode !== 'CREDIT') {
      suggestions.push(`Paid amount is 0 with mode "${body.payment_mode}" â€” switch to Credit or enter the amount received.`);
    }

    if (companyGSTIN && !GSTIN_RE.test(companyGSTIN)) {
      issues.push({
        level: 'warn',
        field: 'company_gstin',
        message: `Your company GSTIN "${companyGSTIN}" looks invalid. Fix it in Settings so GSTR-1 / GSTR-3B exports are correct.`,
      });
    }

    const errorCount = issues.filter((i) => i.level === 'error').length;
    res.json({
      ok: errorCount === 0,
      grandTotal: grand,
      tax: r2(tax),
      issues,
      suggestions,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * POST /api/ai/intents â€” return a *structured, actionable* intent (deep link +
 * suggested action + pre-filled context) for the AI assistant page to render as
 * buttons, instead of just prose. No network/AI key required.
 * { message } -> { intent, title, chip, actions: [{label, to, params}], summary, rows }
 */
async function intents(req, res, next) {
  try {
    const pool = getPool();
    const m = String(req.body?.message || '').toLowerCase().replace(/[?.!,]+/g, ' ').replace(/\s+/g, ' ').trim();
    const p = pickPeriod(m);
    const rng = p.all ? 'all time' : `${p.f} â†’ ${p.t}`;
    const periodClause = (pr, col = 'DATE(created_at)') => (pr.all ? '' : ` AND ${col} BETWEEN ? AND ?`);
    const prms = (pr) => (pr.all ? [] : [pr.f, pr.t]);

    const wrap = (title, chip, actions, summary, rows) => ({ intent: title.toLowerCase().replace(/\s+/g, '-'), title, chip, actions, summary, rows: rows || [] });

    // ---- Returns / refunds guidance ----
    if (/(return|refund|credit\s*note|sale\s*return)/.test(m)) {
      const [recent] = await pool.query(
        `SELECT invoice_number, customer_name, grand_total, invoice_date, status FROM invoices
         WHERE status NOT IN ('CANCELLED') ORDER BY id DESC LIMIT 8`
      );
      return res.json(wrap(
        'Sales returns & refunds',
        'Process a return in one click',
        [
          { label: 'New Return', to: '/returns/new', params: {} },
          { label: 'Return History', to: '/returns', params: {} },
        ],
        'Returns reverse stock & ledger automatically. Open a sale, pick the items being returned, choose a refund method (cash/bank/credit note) â€” the GST framework reverses CGST/SGST/IGST and credits the customer.',
        recent.map((r) => ({ invoice_number: r.invoice_number, customer_name: r.customer_name, grand_total: Number(r.grand_total), status: r.status }))
      ));
    }

    // ---- Dunning / collections -----
    if (/(dun|collect|follow\s*up|overdue|remind|payment\s*due|receivable)/.test(m)) {
      const where = `status IN ('PENDING','PARTIAL')${periodClause(p, 'invoice_date')}`;
      const [rows] = await pool.query(
        `SELECT id, customer_name, invoice_date, due_date, balance_due, customer_id FROM invoices
         WHERE ${where} ORDER BY balance_due DESC LIMIT 20`, prms(p)
      );
      const total = rows.reduce((s, r) => s + Number(r.balance_due), 0);
      return res.json(wrap(
        'Overdue / pending collections',
        `${fmtINR(total)} outstanding across ${rows.length} invoice(s)`,
        [
          { label: 'Open Outstanding Report', to: '/reports', params: {} },
          { label: 'Record Payment', to: '/payment-links', params: {} },
          ...rows.slice(0, 4).map((r) => ({ label: `${r.customer_name} Â· ${fmtINR(r.balance_due)}`, to: '/invoices', params: { id: r.id } })),
        ],
        `${rows.length} pending invoice(s) worth ${fmtINR(total)} (${rng}). Send gentle reminders; post partial receipts as they come in.`,
        rows.slice(0, 10).map((r) => ({ invoice_number: r.id, customer_name: r.customer_name, balance_due: Number(r.balance_due), due_date: r.due_date }))
      ));
    }

    // ---- Top products / stock ----
    if (/(top|best|popular|fastest|stock|low\s*stock|reorder)/.test(m)) {
      const [rows] = await pool.query(
        `SELECT ii.item_name, IFNULL(SUM(ii.quantity),0) qty, IFNULL(SUM(ii.taxable_value),0) val
         FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
         WHERE i.status NOT IN ('CANCELLED')${periodClause(p, 'i.invoice_date')}
         GROUP BY ii.item_name ORDER BY val DESC LIMIT 8`, prms(p)
      );
      return res.json(wrap(
        'Top products & reorder watch',
        `Best seller: ${rows[0]?.item_name || 'â€”'} Â· ${inr(rows[0]?.val || 0)}`,
        [{ label: 'Open Inventory', to: '/inventory', params: {} }, { label: 'All Reports', to: '/reports', params: {} }],
        `Top revenue items (${rng}):\n` + rows.map((r, i) => `${i + 1}. ${r.item_name} â€” ${fmtINR(r.val)} (${r.qty} units)`).join('\n'),
        rows
      ));
    }

    // ---- Sales summary ----
    if (/(sale|revenue|billing|turnover|income)/.test(m)) {
      const [r] = await pool.query(
        `SELECT IFNULL(SUM(grand_total),0) total, COUNT(*) n FROM invoices
         WHERE status NOT IN ('CANCELLED')${periodClause(p, 'invoice_date')}`, prms(p)
      );
      return res.json(wrap(
        'Sales overview',
        `${fmtINR(r[0].total)} across ${r[0].n} sale(s) (${rng})`,
        [{ label: 'Open Reports', to: '/reports', params: {} }, { label: 'Daily DSR', to: '/daily', params: {} }],
        `Total sales ${rng}: ${fmtINR(r[0].total)} from ${r[0].n} invoice(s).`,
        []
      ));
    }

    return res.json(wrap(
      'AI assistant',
      'Try a question â€” e.g. "top products", "overdue bills", "sales this month", "returns"',
      [
        { label: 'Top products', to: '/assistant', params: {} },
        { label: 'Overdue collections', to: '/assistant', params: {} },
        { label: 'Returns', to: '/return/new', params: {} },
        { label: 'GST rates', to: '/tax-rates', params: {} },
      ],
      'Ask about sales, stock, receivables, GST, customers, purchases or profit in plain English â€” I read your live data.',
      []
    ));
  } catch (e) {
    next(e);
  }
}

module.exports = { insights, chat, getSettings, validate, intents };