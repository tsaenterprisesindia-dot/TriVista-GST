import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const CATEGORIES = [
  ['SUGGESTION', 'Suggestion', 'badge-blue'],
  ['FEEDBACK', 'Feedback', 'badge-green'],
  ['COMMENT', 'Comment', 'badge-gray'],
  ['COMPLAINT', 'Complaint', 'badge-red'],
  ['REQUEST', 'Request', 'badge-amber'],
  ['TECHNICAL_SUPPORT', 'Technical Support', 'badge-gray'],
  ['OTHER', 'Other', 'badge-gray'],
];

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map(([v, l]) => [v, l]));
const CATEGORY_BADGE = Object.fromEntries(CATEGORIES.map(([v, l, b]) => [v, b]));

const STATUSES = [
  ['NEW', 'New', 'badge-blue'],
  ['OPEN', 'Open', 'badge-amber'],
  ['IN_PROGRESS', 'In Progress', 'badge-amber'],
  ['RESOLVED', 'Resolved', 'badge-green'],
  ['CLOSED', 'Closed', 'badge-gray'],
];

const STATUS_LABEL = Object.fromEntries(STATUSES.map(([v, l]) => [v, l]));
const STATUS_BADGE = Object.fromEntries(STATUSES.map(([v, l, b]) => [v, b]));

const empty = { category: 'SUGGESTION', subject: '', message: '' };

export default function SupportCenter() {
  const { user } = useAuth();
  const isManager = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [form, setForm] = useState(empty);
  const [filters, setFilters] = useState({ category: '', status: '', q: '' });
  const [managing, setManaging] = useState(null);

  const load = (f = filters) => {
    const params = new URLSearchParams();
    if (f.category) params.set('category', f.category);
    if (f.status) params.set('status', f.status);
    if (f.q) params.set('q', f.q);
    api
      .get(`/feedback?${params.toString()}`)
      .then((d) => { setItems(d.data); setTotal(d.total); })
      .catch((e) => setError(e.message));
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaved('');
    try {
      await api.post('/feedback', form);
      setSaved('Thank you! Your message has been submitted.');
      setForm(empty);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const saveManage = async (m) => {
    try {
      await api.put(`/feedback/${m.id}`, { status: m.status, reply: m.reply });
      setSaved('Message updated.');
      setManaging(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (it) => {
    if (!window.confirm(`Delete "${it.subject}"?`)) return;
    try {
      await api.del(`/feedback/${it.id}`);
      setSaved('Message deleted.');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="success-banner">{saved}</div>}

      <div className="card">
        <div className="card-title">Share your experience</div>
        <p className="muted" style={{ marginTop: 0 }}>
          Suggestions, feedback, comments, complaints, requests or technical support for our CA team and users.
        </p>
        <form onSubmit={submit}>
          <div className="grid-3">
            <div className="field">
              <label>Category *</label>
              <select value={form.category} onChange={set('category')}>
                {CATEGORIES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label>Subject *</label>
              <input value={form.subject} onChange={set('subject')} maxLength={200} placeholder="Short heading" required />
            </div>
          </div>
          <div className="field">
            <label>Message *</label>
            <textarea
              value={form.message}
              onChange={set('message')}
              rows={4}
              maxLength={8000}
              placeholder="Share your experience, idea, problem or question…"
              required
            />
          </div>
          <button className="btn btn-primary" type="submit">Submit</button>
        </form>
      </div>

      <div className="card">
        <div className="card-title">All submissions ({total})</div>
        <div className="grid-3 mb">
          <div className="field">
            <label>Category</label>
            <select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}>
              <option value="">All</option>
              {CATEGORIES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Status</label>
            <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="">All</option>
              {STATUSES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Search</label>
            <input
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              placeholder="Subject / message / name"
            />
          </div>
        </div>
        <div className="flex mb">
          <button className="btn" onClick={() => { setFilters({ category: '', status: '', q: '' }); load({ category: '', status: '', q: '' }); }}>Clear filters</button>
          <button className="btn btn-primary" onClick={() => load()}>Apply</button>
        </div>

        {items.length === 0 ? (
          <div className="empty">No submissions yet — be the first to share your experience.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>From</th>
                <th>Category</th>
                <th>Subject / Message</th>
                <th>Status</th>
                <th>Replied by</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <FragmentRow
                  key={it.id}
                  it={it}
                  isManager={isManager}
                  managing={managing}
                  setManaging={setManaging}
                  saveManage={saveManage}
                  canDelete={isManager || it.user_id === user?.id}
                  remove={remove}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function FragmentRow({ it, isManager, managing, setManaging, saveManage, canDelete, remove }) {
  const [draft, setDraft] = useState({ status: it.status, reply: it.reply || '' });
  const isOpen = managing === it.id;

  return (
    <>
      <tr>
        <td className="nowrap">{it.created_at}</td>
        <td style={{ maxWidth: 180 }}>
          <div style={{ fontWeight: 600 }}>{it.user_name || '—'}</div>
          <div className="muted" style={{ fontSize: 11, wordBreak: 'break-all' }}>{it.user_email}</div>
        </td>
        <td><span className={`badge ${CATEGORY_BADGE[it.category] || 'badge-gray'}`}>{CATEGORY_LABEL[it.category] || it.category}</span></td>
        <td style={{ maxWidth: 360 }}>
          <div style={{ fontWeight: 600 }}>{it.subject}</div>
          <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>{it.message}</div>
          {it.reply && (
            <div className="mt" style={{ borderLeft: '3px solid var(--primary)', paddingLeft: 8, marginTop: 6, fontSize: 13 }}>
              <span className="muted" style={{ fontSize: 11 }}>Reply:</span>{' '}
              <span style={{ whiteSpace: 'pre-wrap' }}>{it.reply}</span>
            </div>
          )}
        </td>
        <td><span className={`badge ${STATUS_BADGE[it.status] || 'badge-gray'}`}>{STATUS_LABEL[it.status] || it.status}</span></td>
        <td className="nowrap">{it.replied_by_name ? `${it.replied_by_name} (${it.replied_at})` : '—'}</td>
        <td className="nowrap">
          {isManager && (
            <button className="btn btn-sm" onClick={() => { setDraft({ status: it.status, reply: it.reply || '' }); setManaging(isOpen ? null : it.id); }}>
              {isOpen ? 'Close' : 'Manage'}
            </button>
          )}
          {canDelete && (
            <button className="btn btn-sm btn-danger" onClick={() => remove(it)}>Delete</button>
          )}
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={7}>
            <div className="card" style={{ margin: 0 }}>
              <div className="grid-3">
                <div className="field">
                  <label>Status</label>
                  <select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>
                    {STATUSES.map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Reply (shown to everyone)</label>
                <textarea rows={3} value={draft.reply} maxLength={8000} onChange={(e) => setDraft((d) => ({ ...d, reply: e.target.value }))} />
              </div>
              <button className="btn btn-primary" onClick={() => saveManage({ id: it.id, status: draft.status, reply: draft.reply })}>Save</button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}