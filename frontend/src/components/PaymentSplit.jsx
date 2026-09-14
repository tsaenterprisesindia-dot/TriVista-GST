const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Split payment input — one or more { mode, amount, reference_no } rows.
 * Props:
 *   total         target amount the rows should add up to (shown as Remaining)
 *   modes         allowed mode list (default CASH/CARD/UPI/BANK/OTHER)
 *   value         [{mode,amount,reference_no}] (controlled)
 *   onChange(next)
 *   exact         require sum === total (e.g. POS / full payment) — else allow
 *                 partial (default partial when onlyAmount safe)
 *   allowNone     render add-row only (start empty, no default row)
 *   withReference show optional reference_no column
 *   label         prefix label
 */
export default function PaymentSplit({
  total,
  modes,
  value,
  onChange,
  exact = false,
  allowNone = false,
  withReference = true,
  label = 'Payment split',
}) {
  const MODES = modes || ['CASH', 'CARD', 'UPI', 'BANK', 'OTHER'];
  const rows = (Array.isArray(value) ? value : []).filter(Boolean);
  const sum = r2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const remaining = r2(Number(total || 0) - sum);

  const updateRow = (i, patch) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, reference_no: r.reference_no || '', ...patch } : r));
    onChange(next);
  };
  const addRow = () => onChange([...rows, { mode: MODES[0], amount: remaining > 0 ? r2(remaining) : 0, reference_no: '' }]);
  const removeRow = (i) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div className="card" style={{ border: '1px solid var(--border)', background: 'var(--bg)' }}>
      <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <b>{label}</b>
        {rows.length > 0 && (
          <span className={Math.abs(remaining) <= 0.005 ? 'muted' : 'muted'} style={{ fontSize: 12 }}>
            Remaining: {inr(remaining)}
          </span>
        )}
      </div>

      {rows.length === 0 && (
        <button type="button" className="btn btn-sm" onClick={addRow}>
          + Add payment mode
        </button>
      )}

      {rows.map((r, i) => (
        <div key={i} className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <select
            value={r.mode}
            onChange={(e) => updateRow(i, { mode: e.target.value })}
            style={{ width: 110 }}
          >
            {MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Amount"
            value={r.amount || ''}
            onChange={(e) => updateRow(i, { amount: e.target.value })}
            style={{ width: 130 }}
          />
          {withReference && (
            <input
              placeholder="UTR / ref (optional)"
              value={r.reference_no || ''}
              onChange={(e) => updateRow(i, { reference_no: e.target.value })}
              style={{ flex: 1, minWidth: 90 }}
            />
          )}
          <button type="button" className="btn btn-sm btn-danger" onClick={() => removeRow(i)}>
            ×
          </button>
        </div>
      ))}

      {rows.length > 0 && (
        <button type="button" className="btn btn-sm" onClick={addRow}>
          + Split mode
        </button>
      )}
    </div>
  );
}