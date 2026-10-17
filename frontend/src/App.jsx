import { useState, useEffect } from 'react';
import { api } from './api';
import { login, logout, getRole, getUsername, isLoggedIn } from './auth';
import './App.css';
import './TrackingPage.css';
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

  /* Replace ONLY the return (...) inside LoginScreen in App.jsx with this JSX.
   Keep handleSubmit, useState, and all authentication logic unchanged. */
return (
  <div className="login-shell login-shell--split">
    <section className="login-intro" aria-label="RationTrace introduction">
      <div className="intro-brand">
        <span className="intro-brand-seal" aria-hidden="true">
          <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
            <circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="32" cy="32" r="23" fill="none" stroke="currentColor" strokeWidth="1" />
            <path d="M32 13c4 7 4 12 0 19-4-7-4-12 0-19ZM32 32c4 7 4 12 0 19-4-7-4-12 0-19ZM13 32c7-4 12-4 19 0-7 4-12 4-19 0ZM32 32c7-4 12-4 19 0-7 4-12 4-19 0Z" fill="currentColor" />
          </svg>
        </span>
        <span>RATIONTRACE</span>
      </div>

      <div className="intro-copy">
        <p className="intro-kicker">PUBLIC DISTRIBUTION SYSTEM</p>
        <h1>Every ration batch.<br /><span>Accounted for.</span></h1>
        <p className="intro-description">
          A transparent, traceable record of ration stock from government allocation
          to warehouse dispatch and distribution at the ration shop.
        </p>

        <div className="intro-feature-list">
          <div className="intro-feature">
            <span className="intro-feature-icon" aria-hidden="true">01</span>
            <div>
              <strong>Traceable stock movement</strong>
              <p>Follow batch records across each distribution stage.</p>
            </div>
          </div>
          <div className="intro-feature">
            <span className="intro-feature-icon" aria-hidden="true">02</span>
            <div>
              <strong>Discrepancy visibility</strong>
              <p>Bring quantity mismatches to the attention of authorized reviewers.</p>
            </div>
          </div>
          <div className="intro-feature">
            <span className="intro-feature-icon" aria-hidden="true">03</span>
            <div>
              <strong>Permissioned access</strong>
              <p>Role-based access for participating system users.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="intro-footer">
        <span className="intro-footer-dot" />
        <span>PUBLIC SERVICE · STOCK TRANSPARENCY · ACCOUNTABILITY</span>
      </div>
    </section>

    <section className="login-panel" aria-label="Sign in">
      <div className="login-panel-top">
        <span className="login-panel-label">OFFICIAL ACCESS</span>
        <span className="login-panel-rule" />
      </div>

      <div className="login-form-wrap">
        <div className="login-form-heading">
          <p className="login-eyebrow">WELCOME BACK</p>
          <h2>Sign in to RationTrace</h2>
          <p>Use the account issued for your system role.</p>
        </div>

        <form onSubmit={handleSubmit} autoComplete="off">
          <label className="ledger-field">
            <span>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="Enter your username"
              required
            />
          </label>

          <label className="ledger-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Enter your password"
              required
            />
          </label>

          {error && <div className="action-result is-error" role="alert">{error}</div>}

          <button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in securely'}
            {!busy && <span aria-hidden="true">→</span>}
          </button>
        </form>

        <div className="login-security-note">
          <span className="security-mark" aria-hidden="true">✓</span>
          <p><strong>Authorized users only</strong><br />Access permissions depend on your assigned role.</p>
        </div>
      </div>

      <div className="login-panel-bottom">
        <span>RATIONTRACE</span>
        <span>Permissioned ledger portal</span>
      </div>
    </section>
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
    const supabaseURL = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    async function loadTracking() {
      try {
        if (!supabaseURL || !supabaseKey) {
          throw new Error('Public tracking is not configured yet.');
        }

        const url = new URL('/rest/v1/batch_tracking', supabaseURL);
        url.searchParams.set('batch_id', `eq.${batchID}`);
        url.searchParams.set('select', '*');
        url.searchParams.set('limit', '1');

        const response = await fetch(url, {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        });

        const rows = await response.json();

        if (!response.ok) {
          throw new Error('Could not retrieve public tracking data.');
        }
        if (!rows.length) {
          throw new Error('Batch not found.');
        }

        const row = rows[0];
        const details = row.tracking_data || {};

        setRecord({
          batchID: row.batch_id,
          commodity: row.commodity,
          status: row.status,
          allocatedQty: Number(row.allocated_quantity || 0),
          dispatchedQty: Number(row.dispatched_quantity || 0),
          receivedQty: Number(row.delivered_quantity || 0),
          soldQty: Number(details.soldQty || 0),
          returnedQty: Number(details.returnedQty || 0),
          discrepancyFlag: Boolean(details.discrepancyFlag),
          discrepancySeverity: details.discrepancySeverity || 'Under review',
          lastUpdatedAt: row.last_updated,
          sourceLocation: row.source_location,
          destinationLocation: row.destination_location,
          allocationDate: row.allocation_date,
          discrepancyLog: Array.isArray(details.discrepancyLog)
            ? details.discrepancyLog
            : [],
        });
      } catch (err) {
        setError(err.message || 'Unable to load tracking data.');
      } finally {
        setLoading(false);
      }
    }

    loadTracking();
  }, [batchID]);

  const stages = [
    { label: 'Allocated by government', done: true, note: 'Batch entered into the distribution ledger' },
    { label: 'Dispatched from warehouse', done: ['DISPATCHED', 'RECEIVED', 'SELLING', 'CLOSED'].includes(record?.status), note: 'Stock dispatch recorded' },
    { label: 'Received at ration shop', done: ['RECEIVED', 'SELLING', 'CLOSED'].includes(record?.status), note: 'Shop receipt recorded' },
    { label: 'Distributed to beneficiaries', done: ['SELLING', 'CLOSED'].includes(record?.status), note: 'Beneficiary distribution activity recorded' },
    { label: 'Batch closed', done: record?.status === 'CLOSED', note: 'Final batch reconciliation completed' },
  ];

  const stockItems = [
    { label: 'Allocated', quantity: record?.allocatedQty, note: 'Government allocation' },
    { label: 'Dispatched', quantity: record?.dispatchedQty, note: 'Left warehouse' },
    { label: 'Received', quantity: record?.receivedQty, note: 'Shop receipt' },
    { label: 'Distributed', quantity: record?.soldQty, note: 'Beneficiary sales', highlight: true },
    { label: 'Returned', quantity: record?.returnedQty, note: 'Returned stock' },
  ];

  const status = String(record?.status || 'UNKNOWN').toUpperCase();
  const dateText = (value) => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
  };

  return (
    <div className="public-tracking-page">
      <header className="tracking-topbar">
        <div className="tracking-brand">
          <span className="tracking-brand-seal" aria-hidden="true">✦</span>
          <div>
            <div className="tracking-brand-name">RationTrace</div>
            <div className="tracking-brand-subtitle">Public Distribution System · Batch Tracking</div>
          </div>
        </div>
        <span className="tracking-public-badge">Public tracking</span>
      </header>

      <div className="tracking-page-heading">
        <div>
          <p className="tracking-page-eyebrow">Supply chain transparency</p>
          <h1>Batch journey</h1>
          <p className="tracking-page-description">
            View recorded stock movement from allocation through distribution.
          </p>
        </div>
        <div className="tracking-reference">
          <span>Batch reference</span>
          <strong>{batchID}</strong>
        </div>
      </div>

      {loading && (
        <div className="tracking-panel" role="status">
          Loading batch tracking information…
        </div>
      )}

      {error && (
        <div className="tracking-alert" role="alert">
          <span className="tracking-alert-icon" aria-hidden="true">!</span>
          <div>
            <strong>Tracking information unavailable</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {record && (
        <>
          {record.discrepancyFlag && (
            <div className="tracking-alert" role="alert">
              <span className="tracking-alert-icon" aria-hidden="true">!</span>
              <div>
                <strong>Stock discrepancy flagged for review</strong>
                <p>
                  A quantity discrepancy or beneficiary complaint has been recorded.
                  Severity: {record.discrepancySeverity}.
                </p>
              </div>
            </div>
          )}

          <section className="tracking-overview-card">
            <div>
              <p className="tracking-overview-label">Batch overview</p>
              <h2>{record.commodity || 'Ration commodity'}</h2>
              <div className="tracking-overview-meta">
                <span>Batch ID: <strong>{record.batchID}</strong></span>
                {record.sourceLocation && <span>From: {record.sourceLocation}</span>}
                {record.destinationLocation && <span>To: {record.destinationLocation}</span>}
              </div>
            </div>
            <span className={`tracking-status-pill ${record.discrepancyFlag ? 'is-warning' : ''}`}>
              {status.replaceAll('_', ' ')}
            </span>
          </section>

          <div className="tracking-content-grid">
            <section className="tracking-panel">
              <div className="tracking-panel-heading">
                <div>
                  <h2>Tracking timeline</h2>
                  <p>Recorded milestones for this ration batch</p>
                </div>
                <span className="tracking-panel-tag">5 stages</span>
              </div>

              <div className="tracking-timeline">
                {stages.map((stage, index) => (
                  <div
                    key={stage.label}
                    className={`tracking-timeline-item ${stage.done ? 'is-complete' : ''}`}
                  >
                    <div className="tracking-timeline-marker" aria-hidden="true">
                      {stage.done ? '✓' : index + 1}
                    </div>
                    <div className="tracking-timeline-copy">
                      <strong>{stage.label}</strong>
                      <p>{stage.done ? 'Completed · recorded in the system' : 'Awaiting recorded completion'}</p>
                      {index === 0 && record.allocationDate && (
                        <time>{dateText(record.allocationDate)}</time>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="tracking-panel">
              <div className="tracking-panel-heading">
                <div>
                  <h2>Stock summary</h2>
                  <p>Quantities recorded for this batch</p>
                </div>
                <span className="tracking-panel-tag">Quantity</span>
              </div>

              <div className="tracking-stock-grid">
                {stockItems.map((item) => (
                  <div
                    key={item.label}
                    className={`tracking-stock-card ${item.highlight ? 'is-highlight' : ''} ${item.label === 'Returned' && item.quantity > 0 ? 'is-alert' : ''}`}
                  >
                    <span>{item.label}</span>
                    <strong>{item.quantity ?? 0}</strong>
                    <small>{item.note}</small>
                  </div>
                ))}
              </div>

              <div className="tracking-location-summary">
                <div className="tracking-location-row">
                  <span>Source warehouse</span>
                  <strong>{record.sourceLocation || 'Not recorded'}</strong>
                </div>
                <div className="tracking-location-row">
                  <span>Destination shop</span>
                  <strong>{record.destinationLocation || 'Not recorded'}</strong>
                </div>
                <div className="tracking-location-row">
                  <span>Last updated</span>
                  <strong>{dateText(record.lastUpdatedAt) || 'Not available'}</strong>
                </div>
              </div>
            </section>
          </div>

          {record.discrepancyLog.length > 0 && (
            <section className="tracking-panel" style={{ marginTop: 20 }}>
              <div className="tracking-panel-heading">
                <div>
                  <h2>Recorded discrepancy details</h2>
                  <p>Issues recorded for authorized review</p>
                </div>
                <span className="tracking-panel-tag">Review</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, color: '#8E3025', lineHeight: 1.8 }}>
                {record.discrepancyLog.map((entry, index) => <li key={index}>{String(entry)}</li>)}
              </ul>
            </section>
          )}

          <footer className="tracking-footer">
            <span><strong>RationTrace</strong> · Public batch information</span>
            <span>Beneficiary personal details are not displayed.</span>
          </footer>
        </>
      )}
    </div>
  );
}
