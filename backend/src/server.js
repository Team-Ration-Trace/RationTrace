// RationTrace Backend
// Express server exposing HTTP endpoints that call the rationtrace chaincode
// through the Fabric Gateway SDK, connected as Org1 (warehouse/government side).
// Now includes login + role-based access control.
//
// Sections:
//   1. Fabric connection setup
//   2. Auth: users, password hashing, JWT issue/verify, role middleware
//   3. Express app + middleware
//   4. Routes (one per chaincode function, each restricted to its role)
//   5. Startup

'use strict';

const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');
const grpc = require('@grpc/grpc-js');
const { connect, signers } = require('@hyperledger/fabric-gateway');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
// ------------------------------------------------------------------
// 1. FABRIC CONNECTION SETUP
// ------------------------------------------------------------------

const CHANNEL_NAME = 'rationchannel';
const CHAINCODE_NAME = 'rationtrace';
const MSP_ID = 'Org1MSP';

const CRYPTO_ROOT = path.resolve(
  __dirname, '..', '..', 'fabric-samples', 'test-network',
  'organizations', 'peerOrganizations', 'org1.example.com'
);
const KEY_DIR = path.join(CRYPTO_ROOT, 'users', 'User1@org1.example.com', 'msp', 'keystore');
const CERT_DIR = path.join(CRYPTO_ROOT, 'users', 'User1@org1.example.com', 'msp', 'signcerts');
const TLS_CERT_PATH = path.join(CRYPTO_ROOT, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');
const PEER_ENDPOINT = 'localhost:7051';
const PEER_HOST_ALIAS = 'peer0.org1.example.com';

async function firstFileIn(dirPath) {
  const files = await fs.readdir(dirPath);
  if (files.length === 0) throw new Error(`No files found in ${dirPath}`);
  return path.join(dirPath, files[0]);
}

async function newGrpcConnection() {
  const tlsRootCert = await fs.readFile(TLS_CERT_PATH);
  const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
  return new grpc.Client(PEER_ENDPOINT, tlsCredentials, {
    'grpc.ssl_target_name_override': PEER_HOST_ALIAS,
  });
}

async function newIdentity() {
  const certPath = await firstFileIn(CERT_DIR);
  const credentials = await fs.readFile(certPath);
  return { mspId: MSP_ID, credentials };
}

async function newSigner() {
  const keyPath = await firstFileIn(KEY_DIR);
  const privateKeyPem = await fs.readFile(keyPath);
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  return signers.newPrivateKeySigner(privateKey);
}

let contract;

async function connectToFabric() {
  const client = await newGrpcConnection();
  const gateway = connect({
    client,
    identity: await newIdentity(),
    signer: await newSigner(),
  });
  const network = gateway.getNetwork(CHANNEL_NAME);
  contract = network.getContract(CHAINCODE_NAME);
  console.log(`Connected to channel '${CHANNEL_NAME}', chaincode '${CHAINCODE_NAME}'`);
}

function parseResult(resultBytes) {
  const text = Buffer.from(resultBytes).toString('utf8');
  if (!text) return null;
  return JSON.parse(text);
}

// ------------------------------------------------------------------
// 2. AUTH
// ------------------------------------------------------------------
//
// NOTE: JWT_SECRET is hardcoded for this college-project demo. In a real
// deployment this would come from an environment variable, never committed
// to source. Fine for a Review 2 build; call this out if asked in viva.
const JWT_SECRET = 'rationtrace-dev-secret-change-in-production';
const TOKEN_TTL = '8h';

// Predefined demo accounts, one per role. Passwords are hashed at startup,
// never stored or compared in plain text.
const RAW_USERS = [
  { username: 'government', password: 'gov123', role: 'government' },
  { username: 'warehouse', password: 'wh123', role: 'warehouse' },
  { username: 'shop', password: 'shop123', role: 'shop' },
  { username: 'auditor', password: 'audit123', role: 'auditor' },
  { username: 'beneficiary', password: 'ben123', role: 'beneficiary' },
];

const USERS = RAW_USERS.map((u) => ({
  username: u.username,
  role: u.role,
  passwordHash: bcrypt.hashSync(u.password, 10),
}));

function findUser(username) {
  return USERS.find((u) => u.username === username);
}

// Verifies the Authorization: Bearer <token> header and attaches req.user.
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing authentication token' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Wraps authenticate() and additionally checks the user's role is allowed.
function requireRole(...allowedRoles) {
  return [
    authenticate,
    (req, res, next) => {
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          error: `Role '${req.user.role}' is not permitted to perform this action`,
        });
      }
      next();
    },
  ];
}

// ------------------------------------------------------------------
// 3. EXPRESS APP
// ------------------------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json());

function asyncRoute(handler) {
  return (req, res) => {
    handler(req, res).catch((err) => {
      console.error(err);
      res.status(500).json({ error: err.message });
    });
  };
}

// ------------------------------------------------------------------
// 4. ROUTES
// ------------------------------------------------------------------

// -- Login (no auth required to reach this one, obviously) --
app.post('/api/login', asyncRoute(async (req, res) => {
  const { username, password } = req.body;
  const user = findUser(username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
  res.json({ token, role: user.role, username: user.username });
}));

// -- Stage functions (writes), each restricted to the role responsible for it --

app.post('/api/allocate', requireRole('government'), asyncRoute(async (req, res) => {
  const { batchID, commodity, manufacturerName, manufacturingPlace, allocatedQty } = req.body;
  await contract.submitTransaction(
    'AllocateBatch', batchID, commodity, manufacturerName, manufacturingPlace, String(allocatedQty)
  );
  res.json({ status: 'ok', batchID });
}));

app.post('/api/dispatch', requireRole('warehouse'), asyncRoute(async (req, res) => {
  const { batchID, dispatchedQty, sourceWarehouse, destinationShop } = req.body;
  await contract.submitTransaction(
    'DispatchBatch', batchID, String(dispatchedQty), sourceWarehouse, destinationShop
  );
  res.json({ status: 'ok', batchID });
}));

app.post('/api/receive', requireRole('shop'), asyncRoute(async (req, res) => {
  const { batchID, receivedQty } = req.body;
  await contract.submitTransaction('ReceiveBatch', batchID, String(receivedQty));
  res.json({ status: 'ok', batchID });
}));

app.post('/api/reject', requireRole('shop'), asyncRoute(async (req, res) => {
  const { batchID, reason } = req.body;
  await contract.submitTransaction('RejectBatch', batchID, reason);
  res.json({ status: 'ok', batchID });
}));

app.post('/api/return', requireRole('shop'), asyncRoute(async (req, res) => {
  const { batchID, qty } = req.body;
  await contract.submitTransaction('ReturnStock', batchID, String(qty));
  res.json({ status: 'ok', batchID });
}));

app.post('/api/close', requireRole('shop', 'auditor'), asyncRoute(async (req, res) => {
  const { batchID } = req.body;
  await contract.submitTransaction('CloseBatch', batchID);
  res.json({ status: 'ok', batchID });
}));

app.post('/api/sell', requireRole('shop'), asyncRoute(async (req, res) => {
  const { batchID, beneficiaryID, entitledQty, actualQtyReceived, shopName } = req.body;
  await contract.submitTransaction(
    'SellToBeneficiary', batchID, beneficiaryID,
    String(entitledQty), String(actualQtyReceived), shopName
  );
  res.json({ status: 'ok', batchID, beneficiaryID });
}));

app.post('/api/complaint', requireRole('beneficiary'), asyncRoute(async (req, res) => {
  const { beneficiaryID, batchID, reason } = req.body;
  await contract.submitTransaction('FileComplaint', beneficiaryID, batchID, reason);
  res.json({ status: 'ok', beneficiaryID, batchID });
}));

// -- Query functions (reads) --

app.get('/api/batch/:batchID', requireRole('auditor', 'government'), asyncRoute(async (req, res) => {
  const result = await contract.evaluateTransaction('GetBatchHistory', req.params.batchID);
  res.json(parseResult(result));
}));

app.get('/api/discrepancies', requireRole('auditor', 'government'), asyncRoute(async (req, res) => {
  const result = await contract.evaluateTransaction('GetAllDiscrepancies');
  res.json(parseResult(result) || []);
}));

app.get('/api/complaints', requireRole('auditor', 'government'), asyncRoute(async (req, res) => {
  const result = await contract.evaluateTransaction('GetComplaints');
  res.json(parseResult(result) || []);
}));

app.get('/api/entitlement/:beneficiaryID/:batchID', requireRole('beneficiary'), asyncRoute(async (req, res) => {
  const { beneficiaryID, batchID } = req.params;
  const result = await contract.evaluateTransaction('CheckMyEntitlement', beneficiaryID, batchID);
  res.json(parseResult(result));
}));

/**
 * Public batch tracking API for QR codes.
 * No login required. Only approved batch-level fields are returned.
 */
// ```javascript
// Generate a QR code for public batch tracking
app.get('/api/public/qr/:batchID', asyncRoute(async (req, res) => {
  const batchID = String(req.params.batchID || '').trim();

  if (!batchID || !/^[a-zA-Z0-9_-]{1,80}$/.test(batchID)) {
    return res.status(400).json({ error: 'Invalid batch ID' });
  }

  const result = await contract.evaluateTransaction(
    'GetBatchHistory',
    batchID
  );

  const record = parseResult(result);

  if (!record || !record.batchID) {
    return res.status(404).json({ error: 'Batch not found' });
  }

  const trackingURL =
  `https://adoption-tier-diverse-violation.trycloudflare.com/api/public/track/${encodeURIComponent(batchID)}`;

  const qrCode = await QRCode.toDataURL(trackingURL);

  res.json({
    batchID,
    trackingURL,
    qrCode
  });
}));
// ```
app.get('/api/public/track/:batchID', asyncRoute(async (req, res) => {
  const batchID = String(req.params.batchID || '').trim();

  if (!batchID || !/^[a-zA-Z0-9_-]{1,80}$/.test(batchID)) {
    return res.status(400).json({
      error: 'Invalid batch ID',
    });
  }

  let record;

  try {
    const result = await contract.evaluateTransaction(
      'GetBatchHistory',
      batchID
    );

    record = parseResult(result);
  } catch (err) {
    // Return 404 for a batch that does not exist.
    if (/does not exist|not found|no record/i.test(err.message || '')) {
      return res.status(404).json({
        error: 'Batch not found',
        batchID,
      });
    }

    throw err;
  }

  if (!record || !record.batchID) {
    return res.status(404).json({
      error: 'Batch not found',
      batchID,
    });
  }

  // Build a public timeline without exposing internal audit identities.
  const statusOrder = [
    'ALLOCATED',
    'DISPATCHED',
    'RECEIVED',
    'SELLING',
    'CLOSED',
    'REJECTED',
  ];

  const currentStatus = String(record.status || 'ALLOCATED').toUpperCase();
  const currentIndex = statusOrder.indexOf(currentStatus);

  const timeline = [
    {
      stage: 'Allocated',
      completed: true,
      timestamp: record.createdAt || null,
    },
    {
      stage: 'Dispatched',
      completed: ['DISPATCHED', 'RECEIVED', 'SELLING', 'CLOSED'].includes(currentStatus),
      timestamp: null,
    },
    {
      stage: 'Received',
      completed: ['RECEIVED', 'SELLING', 'CLOSED'].includes(currentStatus),
      timestamp: null,
    },
    {
      stage: 'Sale',
      completed: ['SELLING', 'CLOSED'].includes(currentStatus),
      timestamp: null,
    },
    {
      stage: currentStatus === 'REJECTED' ? 'Rejected' : 'Closed',
      completed: currentStatus === 'CLOSED' || currentStatus === 'REJECTED',
      timestamp: currentStatus === 'CLOSED' || currentStatus === 'REJECTED'
        ? record.lastUpdatedAt || null
        : null,
    },
  ];

  // Do not return auditTrail, discrepancyLog, beneficiary data,
  // or blockchain identity details from this public endpoint.
  res.json({
    batchID: record.batchID,
    commodity: record.commodity,
    status: currentStatus,
    allocatedQty: record.allocatedQty,
    dispatchedQty: record.dispatchedQty,
    receivedQty: record.receivedQty,
    soldQty: record.soldQty,
    returnedQty: record.returnedQty,
    discrepancyFlag: Boolean(record.discrepancyFlag),
    discrepancySeverity: record.discrepancySeverity || 'NONE',
    lastUpdatedAt: record.lastUpdatedAt || null,
    timeline,
  });
}));

app.get('/api/health', (req, res) => {
  res.json({ status: contract ? 'connected' : 'not connected' });
});

// ------------------------------------------------------------------
// 5. STARTUP
// ------------------------------------------------------------------

const PORT = 3000;

connectToFabric()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`RationTrace backend listening on http://localhost:${PORT}`);
      console.log('Demo accounts: government/gov123, warehouse/wh123, shop/shop123, auditor/audit123, beneficiary/ben123');
    });
  })
  .catch((err) => {
    console.error('Failed to connect to Fabric network:', err);
    process.exit(1);
  });
