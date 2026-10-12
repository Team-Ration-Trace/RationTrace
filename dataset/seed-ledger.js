// seed-ledger.js
// Reads synthetic_dataset.json and pushes every batch through the REAL
// backend API (which in turn writes to the real blockchain), using the
// correct role login for each step — exactly as a real user would.
//
// This does two jobs at once:
//   1. Populates your ledger with a realistic-sized demo dataset.
//   2. Times every transaction, then cross-checks the chaincode's own
//      discrepancy/complaint detection against the dataset's known ground
//      truth — giving you real numbers for the "Final Evaluation Plan"
//      section of Review 2.
//
// Run this AFTER generate-dataset.js, and with the backend server running.

'use strict';

const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000/api';

async function login(username, password) {
  const res = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Login failed for ${username}: ${body.error}`);
  return body.token;
}

// Times a single API call and records it in `latencies`.
async function timedCall(latencies, label, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    latencies.push({ label, ms: Date.now() - start, ok: true });
    return result;
  } catch (err) {
    latencies.push({ label, ms: Date.now() - start, ok: false });
    throw err;
  }
}

async function post(token, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request to ${path} failed`);
  return data;
}

async function get(token, path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request to ${path} failed`);
  return data;
}

async function main() {
  const datasetPath = path.join(__dirname, 'synthetic_dataset.json');
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  console.log(`Loaded ${dataset.batches.length} batches from synthetic_dataset.json`);

  console.log('Logging in as each role...');
  const govToken = await login('government', 'gov123');
  const warehouseToken = await login('warehouse', 'wh123');
  const shopToken = await login('shop', 'shop123');
  const beneficiaryToken = await login('beneficiary', 'ben123');
  const auditorToken = await login('auditor', 'audit123');

  const latencies = [];
  const wallClockStart = Date.now();

  for (const batch of dataset.batches) {
    process.stdout.write(`Seeding ${batch.batchID}... `);

    await timedCall(latencies, 'AllocateBatch', () => post(govToken, '/allocate', {
      batchID: batch.batchID,
      commodity: batch.commodity,
      manufacturerName: batch.manufacturerName,
      manufacturingPlace: batch.manufacturingPlace,
      allocatedQty: batch.allocatedQty,
    }));

    await timedCall(latencies, 'DispatchBatch', () => post(warehouseToken, '/dispatch', {
      batchID: batch.batchID,
      dispatchedQty: batch.dispatchedQty,
      sourceWarehouse: batch.sourceWarehouse,
      destinationShop: batch.destinationShop,
    }));

    await timedCall(latencies, 'ReceiveBatch', () => post(shopToken, '/receive', {
      batchID: batch.batchID,
      receivedQty: batch.receivedQty,
    }));

    for (const ben of batch.beneficiaries) {
      await timedCall(latencies, 'SellToBeneficiary', () => post(shopToken, '/sell', {
        batchID: batch.batchID,
        beneficiaryID: ben.beneficiaryID,
        entitledQty: ben.entitledQty,
        actualQtyReceived: ben.actualQtyReceived,
        shopName: batch.destinationShop,
      }));

      if (ben.expectedComplaint) {
        await timedCall(latencies, 'FileComplaint', () => post(beneficiaryToken, '/complaint', {
          beneficiaryID: ben.beneficiaryID,
          batchID: batch.batchID,
          reason: `Received only ${ben.actualQtyReceived}, entitled to ${ben.entitledQty}`,
        }));
      }
    }

    console.log('done');
  }

  const wallClockMs = Date.now() - wallClockStart;

  // -------- Cross-check detection accuracy against known ground truth --------
  console.log('\nVerifying chaincode detection against injected ground truth...');
  const discrepancies = await get(auditorToken, '/discrepancies');
  const complaints = await get(auditorToken, '/complaints');

  const expectedDiscrepancyBatches = dataset.batches.filter((b) => b.expectedDiscrepancy).map((b) => b.batchID);
  const detectedDiscrepancyBatches = discrepancies.map((d) => d.batchID);
  const discrepancyHits = expectedDiscrepancyBatches.filter((id) => detectedDiscrepancyBatches.includes(id));

  const expectedComplaints = dataset.batches.reduce(
    (sum, b) => sum + b.beneficiaries.filter((x) => x.expectedComplaint).length, 0
  );

  // -------- Performance summary --------
  const successful = latencies.filter((l) => l.ok);
  const avgMs = successful.reduce((s, l) => s + l.ms, 0) / successful.length;
  const maxMs = Math.max(...successful.map((l) => l.ms));
  const minMs = Math.min(...successful.map((l) => l.ms));
  const throughput = (successful.length / (wallClockMs / 1000)).toFixed(2);

  console.log('\n================ EVALUATION SUMMARY ================');
  console.log(`Total transactions submitted: ${latencies.length} (${successful.length} succeeded)`);
  console.log(`Total wall-clock time: ${(wallClockMs / 1000).toFixed(1)}s`);
  console.log(`Average transaction latency: ${avgMs.toFixed(0)} ms`);
  console.log(`Min / Max latency: ${minMs} ms / ${maxMs} ms`);
  console.log(`Approx. throughput: ${throughput} transactions/sec`);
  console.log('');
  console.log(`Discrepancies injected: ${expectedDiscrepancyBatches.length}`);
  console.log(`Discrepancies detected: ${discrepancyHits.length} / ${expectedDiscrepancyBatches.length}`);
  console.log(`Detection accuracy: ${((discrepancyHits.length / expectedDiscrepancyBatches.length) * 100).toFixed(1)}%`);
  console.log('');
  console.log(`Beneficiary shortchanges injected: ${expectedComplaints}`);
  console.log(`Complaints recorded on ledger: ${complaints.length}`);
  console.log('======================================================');
}

main().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
