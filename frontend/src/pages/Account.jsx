import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Account() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaved('');
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirm) {
      setError('New password and confirmation do not match.');
      return;
    }
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      setSaved('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="success-banner">{saved}</div>}

      <div className="card">
        <div className="card-title">My Account</div>
        <div className="grid-3">
          <div className="field">
            <label>Name</label>
            <input value={user?.name || ''} readOnly />
          </div>
          <div className="field">
            <label>Login ID (Email)</label>
            <input value={user?.email || ''} readOnly />
          </div>
          <div className="field">
            <label>Role</label>
            <input value={(user?.role || '').replace('_', ' ')} readOnly />
          </div>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          These are your own account details. Login IDs and passwords of other users
          are only visible to the project admin.
        </p>
      </div>

      <div className="card">
        <div className="card-title">Change My Password</div>
        <form onSubmit={submit} className="mb">
          <div className="grid-3">
            <div className="field">
              <label>Current Password</label>
              <input value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} type="password" autoComplete="current-password" required />
            </div>
            <div className="field">
              <label>New Password (min 8 chars)</label>
              <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="password" autoComplete="new-password" required />
            </div>
            <div className="field">
              <label>Confirm New Password</label>
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} type="password" autoComplete="new-password" required />
            </div>
          </div>
          <button className="btn btn-primary" type="submit">Update Password</button>
        </form>
      </div>
    </>
  );
}