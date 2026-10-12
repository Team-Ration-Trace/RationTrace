import { useState, useEffect } from 'react';
import { api } from './api';
import { login, logout, getRole, getUsername, isLoggedIn } from './auth';
import './App.css';

const SECTIONS = [
  { id: 'allocate', label: 'Allocate' },
  { id: 'dispatch', label: 'Dispatch' },
  { id: 'receive', label: 'Receive' },
  { id: 'sell', label: 'Beneficiary Sale' },
  { id: 'complaint', label: 'File Complaint' },
  { id: 'entitlement', label: 'My Entitlement' },
  { id: 'lookup', label: 'Batch Lookup' },
  { id: 'discrepancies', label: 'Discrepancies' },
  { id: 'complaints', label: 'Complaints' },
];

// Which sections each role is allowed to see. This mirrors the backend's
// requireRole() checks — the UI hides what the server would reject anyway.
const ROLE_SECTIONS = {
  government: ['allocate'],
  warehouse: ['dispatch'],
  shop: ['receive', 'sell'],
  auditor: ['lookup', 'discrepancies', 'complaints'],
  beneficiary: ['complaint', 'entitlement'],
};

const ROLE_LABELS = {
  government: 'Government Allocation Office',
  warehouse: 'Warehouse',
  shop: 'Ration Shop',
  auditor: 'Auditor',
  beneficiary: 'Beneficiary',
};

// ------------------------------------------------------------------
// Shared building blocks
// ------------------------------------------------------------------

function ActionResult({ result }) {
  if (!result) return null;
  return (
    <div className={`action-result ${result.ok ? 'is-ok' : 'is-error'}`}>
      {result.message}
    </div>
  );
}

function LedgerForm({ fields, submitLabel, onSubmit }) {
  const emptyValues = Object.fromEntries(fields.map((f) => [f.name, '']));
  const [values, setValues] = useState(emptyValues);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleChange = (name) => (e) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const payload = { ...values };
      for (const f of fields) {
        if (f.type === 'number') payload[f.name] = Number(payload[f.name]);
      }
      const res = await onSubmit(payload);
      setResult({ ok: true, message: `Recorded on the ledger. ${JSON.stringify(res)}` });
      setValues(emptyValues);
    } catch (err) {
      setResult({ ok: false, message: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="ledger-form" onSubmit={handleSubmit} autoComplete="off">
      {fields.map((f) => (
        <label key={f.name} className="ledger-field">
          <span>{f.label}</span>
          <input
            type={f.type === 'number' ? 'number' : 'text'}
            step={f.type === 'number' ? 'any' : undefined}
            value={values[f.name]}
            onChange={handleChange(f.name)}
            autoComplete="off"
            required
          />
        </label>
      ))}
      <button type="submit" disabled={busy}>
        {busy ? 'Submitting…' : submitLabel}
      </button>
      <ActionResult result={result} />
    </form>
  );
}

function BatchCard({ record }) {
  return (
    <div className={`ledger-card ${record.discrepancyFlag ? 'is-flagged' : ''}`}>
      {record.discrepancyFlag && <div className="stamp">Discrepancy</div>}
      <div className="ledger-card-header">
        <span className="batch-id">{record.batchID}</span>
        <span className={`status-pill status-${record.status?.toLowerCase()}`}>{record.status}</span>
      </div>
      <div className="ledger-grid">
        <div><span>Commodity</span>{record.commodity}</div>
        <div><span>Allocated</span>{record.allocatedQty}</div>
        <div><span>Dispatched</span>{record.dispatchedQty}</div>
        <div><span>Received</span>{record.receivedQty}</div>
        <div><span>Sold</span>{record.soldQty}</div>
        <div><span>Returned</span>{record.returnedQty}</div>
      </div>
      {record.discrepancyLog?.length > 0 && (
        <div className="log-block">
          <h4>Discrepancy Log</h4>
          <ul>{record.discrepancyLog.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}
      <div className="log-block">
        <h4>Audit Trail</h4>
        <ul>{record.auditTrail?.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </div>
    </div>
  );
}

function BatchLookup() {
  const [batchID, setBatchID] = useState('');
  const [record, setRecord] = useState(null);
  const [error, setError] = useState(null);

  const handleLookup = async (e) => {
    e.preventDefault();
    setError(null);
    setRecord(null);
    try {
      setRecord(await api.getBatch(batchID));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <form className="ledger-form inline" onSubmit={handleLookup} autoComplete="off">
        <label className="ledger-field">
          <span>Batch ID</span>
          <input value={batchID} onChange={(e) => setBatchID(e.target.value)} autoComplete="off" required />
        </label>
        <button type="submit">Look up</button>
      </form>
      {error && <div className="action-result is-error">{error}</div>}
      {record && <BatchCard record={record} />}
    </div>
  );
}

function QRCodeGenerator() {
  const [batchID, setBatchID] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [trackingURL, setTrackingURL] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const generateQR = async (e) => {
    e.preventDefault();
    setError('');
    setQrCode('');
    setTrackingURL('');
    setBusy(true);

    try {
      const response = await fetch(
        `http://localhost:3000/api/public/qr/${encodeURIComponent(batchID.trim())}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Could not generate QR code');
      }

      setQrCode(data.qrCode);
      setTrackingURL(data.trackingURL);
    } catch (err) {
      setError(err.message || 'Unable to connect to the backend');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>Ration Batch QR Code</h2>
      <p className="section-note">
        Generate a QR code for public batch tracking.
      </p>

      <form className="ledger-form inline" onSubmit={generateQR}>
        <label className="ledger-field">
          <span>Batch ID</span>
          <input
            value={batchID}
            onChange={(e) => setBatchID(e.target.value)}
            placeholder="e.g. BATCH10055"
            required
          />
        </label>

        <button type="submit" disabled={busy}>
          {busy ? 'Generating…' : 'Generate QR'}
        </button>
      </form>

      {error && <div className="action-result is-error">{error}</div>}

      {qrCode && (
        <div className="ledger-card">
          <div className="ledger-card-header">
            <span className="batch-id">{batchID}</span>
            <span className="status-pill">QR Ready</span>
          </div>

          <img
            src={qrCode}
            alt={`Public tracking QR code for ${batchID}`}
            style={{ width: 220, maxWidth: '100%', display: 'block', margin: '20px auto' }}
          />

          <p>
            <strong>Tracking URL:</strong>
          </p>
          <p style={{ overflowWrap: 'anywhere' }}>{trackingURL}</p>

          <a href={qrCode} download={`${batchID}-QR.png`}>
            <button type="button">Download QR Code</button>
          </a>
        </div>
      )}
    </section>
  );
}

function EntitlementLookup() {
  const [beneficiaryID, setBeneficiaryID] = useState('');
  const [batchID, setBatchID] = useState('');
  const [entitlement, setEntitlement] = useState(null);
  const [error, setError] = useState(null);

  const handleLookup = async (e) => {
    e.preventDefault();
    setError(null);
    setEntitlement(null);
    try {
      setEntitlement(await api.getEntitlement(beneficiaryID, batchID));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <form className="ledger-form" onSubmit={handleLookup} autoComplete="off">
        <label className="ledger-field">
          <span>Beneficiary ID</span>
          <input value={beneficiaryID} onChange={(e) => setBeneficiaryID(e.target.value)} autoComplete="off" required />
        </label>
        <label className="ledger-field">
          <span>Batch ID</span>
          <input value={batchID} onChange={(e) => setBatchID(e.target.value)} autoComplete="off" required />
        </label>
        <button type="submit">Check Entitlement</button>
      </form>
      {error && <div className="action-result is-error">{error}</div>}
      {entitlement && (
        <div className={`ledger-card ${entitlement.complaintFlag ? 'is-flagged' : ''}`}>
          {entitlement.complaintFlag && <div className="stamp">Complaint</div>}
          <div className="ledger-card-header">
            <span className="batch-id">{entitlement.beneficiaryID}</span>
            <span className="status-pill">{entitlement.shopName}</span>
          </div>
          <div className="ledger-grid">
            <div><span>Entitled</span>{entitlement.entitledQty}</div>
            <div><span>Actually Received</span>{entitlement.actualQtyReceived}</div>
          </div>
          {entitlement.complaintReason && (
            <div className="log-block">
              <h4>Your Complaint</h4>
              <p>{entitlement.complaintReason}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DiscrepancyRegister() {
  const [records, setRecords] = useState(null);
  const [error, setError] = useState(null);

  const refresh = async () => {
    setError(null);
    try {
      setRecords(await api.getDiscrepancies());
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <button className="refresh-btn" onClick={refresh}>Refresh register</button>
      {error && <div className="action-result is-error">{error}</div>}
      {records && records.length === 0 && <p className="empty-note">No discrepancies on record.</p>}
      {records?.map((r) => <BatchCard key={r.batchID} record={r} />)}
    </div>
  );
}

function ComplaintsRegister() {
  const [complaints, setComplaints] = useState(null);
  const [error, setError] = useState(null);

  const refresh = async () => {
    setError(null);
    try {
      setComplaints(await api.getComplaints());
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <button className="refresh-btn" onClick={refresh}>Refresh register</button>
      {error && <div className="action-result is-error">{error}</div>}
      {complaints && complaints.length === 0 && <p className="empty-note">No open complaints.</p>}
      {complaints?.map((c, i) => (
        <div className="ledger-card is-flagged" key={i}>
          <div className="stamp">Complaint</div>
          <div className="ledger-card-header">
            <span className="batch-id">{c.beneficiaryID}</span>
            <span className="status-pill status-flagged">Batch {c.batchID}</span>
          </div>
          <div className="ledger-grid">
            <div><span>Entitled</span>{c.entitledQty}</div>
            <div><span>Received</span>{c.actualQtyReceived}</div>
            <div><span>Shop</span>{c.shopName}</div>
          </div>
          <div className="log-block">
            <h4>Reason</h4>
            <p>{c.complaintReason}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------
// Login screen
// ------------------------------------------------------------------

function LoginScreen({ onLoggedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await login(username, password);
      onLoggedIn(session.role);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-seal">
          <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
            <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="32" cy="32" r="24" fill="none" stroke="currentColor" strokeWidth="1" />
            <path
              d="M32 16c3 6 3 10 0 16 -3-6-3-10 0-16Z M32 32c3 6 3 10 0 16 -3-6-3-10 0-16Z M16 32c6-3 10-3 16 0 -6 3-10 3-16 0Z M32 32c6-3 10-3 16 0 -6 3-10 3-16 0Z"
              fill="currentColor"
            />
          </svg>
        </div>
        <p className="login-eyebrow">Public Distribution System</p>
        <h1>RationTrace</h1>
        <p className="tagline">Permissioned ledger — official access portal</p>
        <form onSubmit={handleSubmit} autoComplete="off">
          <label className="ledger-field">
            <span>Username</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required />
          </label>
          <label className="ledger-field">
            <span>Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {error && <div className="action-result is-error">{error}</div>}
        </form>
        <p className="login-footnote">Access issued per role by the system administrator</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Main app
// ------------------------------------------------------------------

export default function App() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());
  const [role, setRole] = useState(getRole());
  const allowedSections = SECTIONS.filter((s) => ROLE_SECTIONS[role]?.includes(s.id));
  const [active, setActive] = useState(allowedSections[0]?.id);

  const handleLoggedIn = (newRole) => {
    setRole(newRole);
    setLoggedIn(true);
    const firstAllowed = SECTIONS.find((s) => ROLE_SECTIONS[newRole]?.includes(s.id));
    setActive(firstAllowed?.id);
  };

  const handleLogout = () => {
    logout();
    setLoggedIn(false);
    setRole(null);
  };

  const trackingMatch = window.location.pathname.match(
  /^\/track\/([a-zA-Z0-9_-]{1,80})$/
);

if (trackingMatch) {
  return <PublicTrackingPage batchID={trackingMatch[1]} />;
}

if (!loggedIn) {
  return <LoginScreen onLoggedIn={handleLoggedIn} />;
}

  return (
    <div className="app-shell">
      <aside className="register-index">
        <h1>RationTrace</h1>
        <p className="tagline">{ROLE_LABELS[role] || role}</p>
        <nav>
          {allowedSections.map((s) => (
            <button
              key={s.id}
              className={active === s.id ? 'is-active' : ''}
              onClick={() => setActive(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <button className="logout-btn" onClick={handleLogout}>
          Sign out ({getUsername()})
        </button>
      </aside>

      <main className="ledger-page">
        {active === 'allocate' && (
          <section>
            <h2>Allocate Batch</h2>
            <p className="section-note">Recorded by the government allocation office.</p>
            <LedgerForm
              submitLabel="Allocate"
              fields={[
                { name: 'batchID', label: 'Batch ID' },
                { name: 'commodity', label: 'Commodity' },
                { name: 'manufacturerName', label: 'Manufacturer' },
                { name: 'manufacturingPlace', label: 'Manufacturing Place' },
                { name: 'allocatedQty', label: 'Allocated Quantity', type: 'number' },
              ]}
              onSubmit={api.allocate}
            />
          </section>
        )}
         {active === 'allocate' && <QRCodeGenerator />}
        {active === 'dispatch' && (
          <section>
            <h2>Dispatch Batch</h2>
            <p className="section-note">Recorded by the warehouse when stock leaves for a shop.</p>
            <LedgerForm
              submitLabel="Dispatch"
              fields={[
                { name: 'batchID', label: 'Batch ID' },
                { name: 'dispatchedQty', label: 'Dispatched Quantity', type: 'number' },
                { name: 'sourceWarehouse', label: 'Source Warehouse' },
                { name: 'destinationShop', label: 'Destination Shop' },
              ]}
              onSubmit={api.dispatch}
            />
          </section>
        )}

        {active === 'receive' && (
          <section>
            <h2>Receive Batch</h2>
            <p className="section-note">Recorded by the ration shop confirming what arrived.</p>
            <LedgerForm
              submitLabel="Confirm Receipt"
              fields={[
                { name: 'batchID', label: 'Batch ID' },
                { name: 'receivedQty', label: 'Received Quantity', type: 'number' },
              ]}
              onSubmit={api.receive}
            />
          </section>
        )}

        {active === 'sell' && (
          <section>
            <h2>Sell to Beneficiary</h2>
            <p className="section-note">Recorded at the point of sale to a citizen.</p>
            <LedgerForm
              submitLabel="Record Sale"
              fields={[
                { name: 'batchID', label: 'Batch ID' },
                { name: 'beneficiaryID', label: 'Beneficiary ID' },
                { name: 'entitledQty', label: 'Entitled Quantity', type: 'number' },
                { name: 'actualQtyReceived', label: 'Actual Quantity Given', type: 'number' },
                { name: 'shopName', label: 'Shop Name' },
              ]}
              onSubmit={api.sell}
            />
          </section>
        )}

        {active === 'complaint' && (
          <section>
            <h2>File a Complaint</h2>
            <p className="section-note">Dispute a short quantity you received.</p>
            <LedgerForm
              submitLabel="File Complaint"
              fields={[
                { name: 'beneficiaryID', label: 'Your Beneficiary ID' },
                { name: 'batchID', label: 'Batch ID' },
                { name: 'reason', label: 'Reason' },
              ]}
              onSubmit={api.complaint}
            />
          </section>
        )}

        {active === 'entitlement' && (
          <section>
            <h2>My Entitlement</h2>
            <p className="section-note">Check what you were entitled to vs. what was recorded as given to you.</p>
            <EntitlementLookup />
          </section>
        )}

        {active === 'lookup' && (
          <section>
            <h2>Batch Lookup</h2>
            <p className="section-note">Full ledger history for one batch.</p>
            <BatchLookup />
          </section>
        )}

        {active === 'discrepancies' && (
          <section>
            <h2>Auditor Register — Discrepancies</h2>
            <p className="section-note">Every batch currently flagged with a quantity mismatch.</p>
            <DiscrepancyRegister />
          </section>
        )}

        {active === 'complaints' && (
          <section>
            <h2>Auditor Register — Complaints</h2>
            <p className="section-note">Open beneficiary complaints across all shops.</p>
            <ComplaintsRegister />
          </section>
        )}
      </main>
    </div>
  );
}
function PublicTrackingPage({ batchID }) {
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(
      `https://wall-maker-brooks-sparc.trycloudflare.com/api/public/track/${encodeURIComponent(batchID)}`
    )
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Batch not found');
        }
        setRecord(data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [batchID]);

  const stages = [
    { label: 'Allocated', done: true },
    { label: 'Dispatched', done: ['DISPATCHED', 'RECEIVED', 'SELLING', 'CLOSED'].includes(record?.status) },
    { label: 'Received at ration shop', done: ['RECEIVED', 'SELLING', 'CLOSED'].includes(record?.status) },
    { label: 'Distribution to beneficiaries', done: ['SELLING', 'CLOSED'].includes(record?.status) },
    { label: 'Batch closed', done: record?.status === 'CLOSED' },
  ];

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: 20, fontFamily: 'Arial, sans-serif', color: '#18352a' }}>
      <h1 style={{ color: '#176b45' }}>RationTrace</h1>
      <p>Public Distribution System · Batch Tracking</p>
      <hr />

      {loading && <p>Loading tracking information...</p>}
      {error && <p style={{ color: '#b42318' }}>{error}</p>}

      {record && (
        <>
          <p style={{ color: '#667085' }}>BATCH ID</p>
          <h2>{record.batchID}</h2>
          <p>Commodity: <strong>{record.commodity}</strong></p>
          <p>Current status: <strong>{record.status}</strong></p>

          {record.discrepancyFlag && (
            <div style={{ padding: 12, background: '#fff0e5', color: '#9a3412', borderRadius: 8 }}>
              Warning: A stock discrepancy has been flagged.
              Severity: {record.discrepancySeverity}
            </div>
          )}

          <h3>Tracking timeline</h3>
          {stages.map((stage, index) => (
            <div key={stage.label} style={{ display: 'flex', gap: 12, margin: '18px 0' }}>
              <div style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: stage.done ? '#176b45' : '#e5e7eb',
                color: stage.done ? 'white' : '#667085',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                {stage.done ? '✓' : index + 1}
              </div>
              <div>
                <strong>{stage.label}</strong>
                <p style={{ margin: '4px 0', color: '#667085' }}>
                  {stage.done ? 'Completed' : 'Pending'}
                </p>
              </div>
            </div>
          ))}

          <h3>Stock summary</h3>
          {[
            ['Allocated', record.allocatedQty],
            ['Dispatched', record.dispatchedQty],
            ['Received', record.receivedQty],
            ['Distributed', record.soldQty],
            ['Returned', record.returnedQty],
          ].map(([label, quantity]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #e5e7eb' }}>
              <span>{label}</span>
              <strong>{quantity ?? 0}</strong>
            </div>
          ))}

          <p style={{ marginTop: 24, color: '#667085', fontSize: 13 }}>
            Last updated: {record.lastUpdatedAt ? new Date(record.lastUpdatedAt).toLocaleString() : 'Not available'}
          </p>
          <p style={{ color: '#667085', fontSize: 12 }}>
            Public batch information · No beneficiary personal data displayed
          </p>
        </>
      )}
    </div>
  );
}