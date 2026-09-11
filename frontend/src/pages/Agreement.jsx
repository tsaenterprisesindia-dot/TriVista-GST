import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const LAST_UPDATED = '11 September 2026';

function Section({ num, title, children }) {
  return (
    <div className="mb" style={{ marginBottom: 18 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
        {num}. {title}
      </h3>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-line' }}>{children}</div>
    </div>
  );
}

export default function Agreement() {
  const { user, acceptTerms, logout } = useAuth();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const mustAccept = !!user && !user.terms_accepted;

  const handleAccept = async () => {
    setError('');
    if (!mustAccept) {
      navigate('/');
      return;
    }
    setBusy(true);
    try {
      await acceptTerms();
      navigate('/');
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const handleDecline = () => {
    if (!window.confirm('If you do not accept the Terms of Service you will be signed out and cannot use TriVista GST ERP.')) return;
    logout();
    navigate('/login');
  };

  return (
    <div className="auth-wrap">
      <div style={{ width: 'min(820px, 96vw)', maxHeight: '94vh', display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div className="card" style={{ borderBottom: 'none', borderRadius: '16px 16px 0 0', marginBottom: 0, padding: '20px 24px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img src="/logo.png" alt="TriVista GST logo" style={{ height: 34 }} />
            <div>
              <h2 style={{ fontSize: 17, margin: 0 }}>Terms of Service</h2>
              <div className="muted" style={{ fontSize: 12 }}>TriVista GST ERP · A Unit of TSA Enterprises · Last updated: {LAST_UPDATED}</div>
            </div>
          </div>
          {mustAccept && (
            <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
              Welcome, <strong>{user.name}</strong>. Please read this agreement carefully before using the application.
            </div>
          )}
        </div>

        <div className="card" style={{ overflowY: 'auto', borderRadius: 0, marginBottom: 0, flex: 1, minHeight: 200 }}>
          <Section num={1} title="Acceptance of Terms">
            {'By registering, being registered by an administrator, or logging in to the TriVista GST ERP application ("the Application"), you agree to these Terms of Service. If you do not agree, do not use the Application.'}
          </Section>
          <Section num={2} title="About the Application">
            {'The Application is an enterprise GST-billing and business-management suite provided by TSA Enterprises ("the Firm") for its own operations and for the operations of its clients. It includes invoicing, point of sale, inventory, accounting, GST e-invoice and e-way bill support, reconciliation, recurring billing, custom AI assistance, API integrations and UPI payment collection links.'}
          </Section>
          <Section num={3} title="Accounts and Credentials">
            {'Your login ID (email) and password are personal and confidential. You are responsible for keeping your credentials secure and for all activity performed under your account.\n\nThe project/super administrator manages user accounts, roles and passwords. Only the super administrator can view the list of user accounts and reset passwords. Users cannot see other users\u2019 login IDs, passwords or password changes. Do not share your credentials with anyone, including colleagues, and do not reveal them through the support or feedback channel.'}
          </Section>
          <Section num={4} title="User Responsibilities and Acceptable Use">
            {'You agree to use the Application only for legitimate business purposes and to enter accurate, complete and up-to-date information. You must not: attempt to access another user\u2019s account; tamper with, reverse-engineer or interfere with the Application or its database; input false, misleading or unlawful data; use the Application to violate any law, regulation or GST requirement; or share your account with others.'}
          </Section>
          <Section num={5} title="Data, Privacy and Confidentiality">
            {'All data entered into the Application \u2014 including customer and vendor details, financial records, invoices and tax data \u2014 remains the property of the firm that owns the installation. Users must treat business, financial and personal data as confidential and use it only for their assigned duties.\n\nThe Application records an audit log of who performed which action for accountability. Other users may see your display name and your reports, but not your login ID or password.'}
          </Section>
          <Section num={6} title="GST and Regulatory Compliance">
            {'The Application assists with billing, record-keeping and e-invoice/e-way bill generation, but it does not provide legal, accounting or tax advice. The Firm and its users remain solely responsible for ensuring that all bills, returns, filings, classifications and payments comply with the Goods and Services Tax Act and other applicable laws. Live e-invoice/e-way bill submission requires the firm\u2019s own credentials and authorisation from the relevant authorities.'}
          </Section>
          <Section num={7} title="Payments and UPI Payment Links">
            {'Where the Application generates UPI or other payment collection links, the payments are collected directly by the merchant. The Application only renders and tracks the link and its status (active, paid or cancelled). The merchant is responsible for verifying, reconciling and accounting for all payments received, and for refunds and disputes.'}
          </Section>
          <Section num={8} title="API Keys, Integrations and AI">
            API keys generated in the Application protect integration access. Keep them secret and revoke them if compromised. AI assistance features are experimental and provided 'as available'; outputs should be verified before business use.
          </Section>
          <Section num={9} title="Intellectual Property">
            {'The Application, including its software, design, and documentation, is the intellectual property of TSA Enterprises. You receive a limited, non-exclusive right to use the Application for your business. You may not copy, resell or redistribute it unless separately authorised.'}
          </Section>
          <Section num={10} title="Availability and Disclaimer">
            {'The Application is provided on an \u201cas is\u201d and \u201cas available\u201d basis without warranties of any kind. While reasonable efforts are made to protect data, you are encouraged to keep regular backups and to verify critical records.'}
          </Section>
          <Section num={11} title="Limitation of Liability">
            {'To the maximum extent permitted by law, TSA Enterprises, the super administrator and the firm operating the Application shall not be liable for indirect, incidental or consequential damages, or for losses arising from errors in data, missed statutory deadlines, or the unauthorised use of accounts. Your sole remedy for disputes is to stop using the Application.'}
          </Section>
          <Section num={12} title="Termination">
            {'The super administrator may suspend or remove user accounts at any time, including for violating these Terms. You may stop using the Application at any time. Terms that by their nature should survive termination (confidentiality, IP, limitation of liability) will continue to apply.'}
          </Section>
          <Section num={13} title="Changes to These Terms">
            {'These Terms may be updated from time to time. When the Terms change, you will be asked to review and accept the updated version before continuing to use the Application.'}
          </Section>
          <Section num={14} title="Governing Law">
            {'These Terms are governed by the laws of India and the jurisdiction of the courts where the firm operating the Application is registered.'}
          </Section>
          <Section num={15} title="Contact">
            {'For questions, support or feedback about these Terms, please use the Support & Feedback page in the Application or contact the project administrator.'}
          </Section>
        </div>

        <div className="card" style={{ borderRadius: '0 0 16px 16px', marginBottom: 0, padding: '14px 24px' }}>
          {mustAccept ? (
            <div>
              {error && <div className="error-banner" style={{ marginBottom: 10 }}>{error}</div>}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1 }} />
                <span>I have read and I agree to the Terms of Service and the User Agreement for TriVista GST ERP.</span>
              </label>
              <div className="flex" style={{ gap: 10 }}>
                <button className="btn btn-primary" disabled={!checked || busy} onClick={handleAccept}>
                  {busy ? 'Saving…' : 'Accept & Continue'}
                </button>
                <button className="btn" onClick={handleDecline}>Decline</button>
              </div>
            </div>
          ) : (
            <div className="flex" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span className="muted" style={{ fontSize: 13 }}>
                ✓ You have accepted the Terms of Service{user?.accepted_terms_at ? ` on ${new Date(user.accepted_terms_at).toLocaleString()}` : ''}.
              </span>
              <button className="btn btn-primary" onClick={() => navigate('/')}>Back to Application</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}