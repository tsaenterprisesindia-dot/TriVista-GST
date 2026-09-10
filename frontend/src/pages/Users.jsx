import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const ROLES = ['ADMIN', 'ACCOUNTANT', 'SALES', 'STORE', 'VIEWER'];

const empty = { name: '', email: '', password: '', phone: '', role: 'SALES' };

export default function Users() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(empty);

  const load = () => {
    api.get('/auth/users').then(setUsers).catch((e) => setError(e.message));
  };

  useEffect(() => {
    if (user?.role === 'SUPER_ADMIN') load();
  }, [user]);

  if (user?.role !== 'SUPER_ADMIN') {
    return <div className="card">Access restricted — super admin only.</div>;
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaved('');
    try {
      await api.post('/auth/users', form);
      setSaved(`User ${form.email} created.`);
      setShowForm(false);
      setForm(empty);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const changeRole = async (u, role) => {
    try {
      await api.put(`/auth/users/${u.id}`, { name: u.name, phone: u.phone, role, is_active: u.is_active });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleActive = async (u) => {
    try {
      await api.put(`/auth/users/${u.id}`, { name: u.name, phone: u.phone, role: u.role, is_active: !u.is_active });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (u) => {
    if (!window.confirm(`Delete user "${u.name}"?`)) return;
    try {
      await api.del(`/auth/users/${u.id}`);
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
        <div className="card-title">
          <span>Team Members</span>
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>+ New User</button>
        </div>

        {showForm && (
          <form onSubmit={submit} className="mb">
            <div className="grid-3">
              <div className="field">
                <label>Name *</label>
                <input value={form.name} onChange={set('name')} required />
              </div>
              <div className="field">
                <label>Email *</label>
                <input value={form.email} onChange={set('email')} type="email" required />
              </div>
              <div className="field">
                <label>Password *</label>
                <input value={form.password} onChange={set('password')} type="password" required />
              </div>
              <div className="field">
                <label>Phone</label>
                <input value={form.phone} onChange={set('phone')} />
              </div>
              <div className="field">
                <label>Role</label>
                <select value={form.role} onChange={set('role')}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex">
              <button className="btn btn-primary" type="submit">Create User</button>
              <button className="btn" type="button" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      <div className="card">
        <div className="card-title">Users</div>
        {users.length === 0 ? (
          <div className="empty">No users yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Active</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name} <span className="muted">({u.phone || '—'})</span></td>
                  <td>{u.email}</td>
                  <td>
                    <select value={u.role} onChange={(e) => changeRole(u, e.target.value)} style={{ width: 150 }}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      className={`btn btn-sm ${u.is_active ? '' : 'btn-danger'}`}
                      onClick={() => toggleActive(u)}
                    >
                      {u.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="nowrap">{u.created_at}</td>
                  <td className="nowrap">
                    <button className="btn btn-sm btn-danger" onClick={() => remove(u)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}