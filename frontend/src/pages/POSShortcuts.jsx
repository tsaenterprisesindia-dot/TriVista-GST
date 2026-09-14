import { Link } from 'react-router-dom';

const keys = [
  { k: 'F2', d: 'Focus the product search box (also Ctrl+K or type /)' },
  { k: 'Type / Scan', d: 'Search products by name, SKU or barcode inside the search box' },
  { k: 'Enter', d: 'Add the highlighted product to the cart. A barcode/SKU scanner works like typing + Enter' },
  { k: '↑ ↓', d: 'Move the product highlight up/down (start at F2 / search box)' },
  { k: '+ / −', d: 'Increase / decrease quantity of the last cart line (page not focused on an input)' },
  { k: 'F3', d: 'Cycle retail → wholesale → distributor pricing for new lines' },
  { k: 'F4', d: 'Hold the current bill (kept in this browser so you can serve other customers)' },
  { k: 'F8', d: 'Resume the most recently held bill' },
  { k: 'F6', d: 'Charge / complete the sale with the selected payment mode' },
  { k: 'Esc', d: 'Close the receipt or the held-bills list' },
  { k: 'Del', d: 'Remove the last cart line (page not focused on an input)' },
  { k: '?', d: 'Open this shortcuts page in a new tab (cart is preserved)' },
];

const steps = [
  { t: '1. Find the product', d: 'Click the search box (F2) and type the product name, SKU or barcode — matching products appear live. Barcode scanners behave like typing the code and pressing Enter.' },
  { t: '2. Add & adjust', d: 'Press Enter (or tap the tile) to add. Use ↑ ↓ to pick a different result. Tap a line’s Qty to type a quantity, or press +/− for the last line. Type a rupee (₹) discount in the Disc column per line.' },
  { t: '3. Choose customer & payment', d: 'Default is Walk-in Customer with Cash. Use the dropdowns to pick a customer (credit check is automatic via GSTIN state) and Payment Mode: Cash, Card, UPI, Bank or Other.' },
  { t: '4. Charge (F6)', d: 'The server recomputes price, discount and GST (CGST/SGST or IGST based on the delivery state), deducts stock, records the payment, updates the customer balance and posts the accounting entries automatically.' },
  { t: '5. Tenders & returns', d: 'Print the receipt from the sale-completed screen. For returns, open the invoice in Invoices and cancel it — stock and ledger are restored automatically.' },
  { t: 'Hold & resume', d: 'F4 parks the current cart as a held bill; F8 brings back the latest one. Open “Held Bills” on the POS screen to see or delete held bills. Held bills live in this browser, so they survive a page refresh.' },
];

const note = [
  'Discounts are per line, in rupees (₹). The total discount, taxable value and GST are shown live.',
  'GST is calculated on the taxable value (price × qty − discount) using the product’s GST rate.',
  'Prices default to retail. Press F3 (or use the Pricing selector) to cycle Retail, Wholesale or Distributor pricing for new lines; the closest lower tier is used when a price is blank.',
];

export default function POSShortcuts() {
  return (
    <div className="content">
      <div className="card-title" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>POS Shortcuts & Billing Guide</h2>
        <Link to="/pos" className="btn btn-primary">Open POS</Link>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Keyboard shortcuts</div>
        <table>
          <thead>
            <tr><th style={{ width: 160 }}>Key</th><th>What it does</th></tr>
          </thead>
          <tbody>
            {keys.map((r) => (
              <tr key={r.k}>
                <td><b>{r.k}</b></td>
                <td>{r.d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Fast billing workflow</div>
        {steps.map((s) => (
          <div key={s.t} className="row" style={{ marginBottom: 10 }}>
            <div style={{ flex: '0 0 220px' }}><b>{s.t}</b></div>
            <div className="muted">{s.d}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-title">How amounts are calculated</div>
        {note.map((n) => (
          <div key={n} className="muted" style={{ marginBottom: 8 }}>• {n}</div>
        ))}
        <div className="muted mt">Tip: on tablets/phones, use the on-screen buttons — shortcuts are for desktop counters. You can print this page with your browser’s Print command and keep it by the register.</div>
      </div>
    </div>
  );
}