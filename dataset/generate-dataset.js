// generate-dataset.js
// Produces a synthetic RationTrace dataset: a set of batches moving through
// Allocate -> Dispatch -> Receive -> Sell, with a controlled number of
// deliberately injected discrepancies (both at the shop-receipt stage and
// at the beneficiary-sale stage) so the chaincode's detection can be
// measured against a known ground truth.
//
// Output: dataset/synthetic_dataset.json

'use strict';

const fs = require('fs');
const path = require('path');

// Simple seeded PRNG (mulberry32) so the same dataset is produced every run —
// useful so your screenshots/report numbers stay consistent if you regenerate.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);

function pick(arr) {
  return arr[Math.floor(rand() * arr.length)];
}
function intBetween(min, max) {
  return Math.floor(min + rand() * (max - min + 1));
}

const COMMODITIES = ['Rice', 'Wheat', 'Sugar', 'Kerosene'];
const MANUFACTURERS = ['ABC Mills', 'Delta Agro', 'Sri Lakshmi Traders', 'Coastal Foodgrains', 'Vellore Agro Co'];
const PLACES = ['Thanjavur', 'Coimbatore', 'Trichy', 'Madurai', 'Salem'];
const WAREHOUSES = ['Central Warehouse', 'North Depot', 'East Depot', 'South Depot'];
const SHOPS = ['Shop 5', 'Shop 12', 'Shop 21', 'Shop 34', 'Shop 47'];

const NUM_BATCHES = 25;
const RECEIVE_DISCREPANCY_RATE = 0.24; // ~24% of batches under-received on purpose
const BENEFICIARY_SHORTCHANGE_RATE = 0.2; // ~20% of beneficiary sales shortchanged

const batches = [];

for (let i = 1; i <= NUM_BATCHES; i++) {
  const batchID = `BATCH${String(100 + i)}`;
  const allocatedQty = intBetween(200, 800);
  const dispatchedQty = allocatedQty; // dispatch always matches allocation in this dataset
  const injectReceiveDiscrepancy = rand() < RECEIVE_DISCREPANCY_RATE;
  const receivedQty = injectReceiveDiscrepancy
    ? Math.round(dispatchedQty * (1 - (0.05 + rand() * 0.10))) // 5-15% short
    : dispatchedQty;

  const numBeneficiaries = intBetween(2, 4);
  const beneficiaries = [];
  for (let b = 1; b <= numBeneficiaries; b++) {
    const entitledQty = intBetween(5, 15);
    const shortchange = rand() < BENEFICIARY_SHORTCHANGE_RATE;
    const actualQtyReceived = shortchange
      ? Math.max(1, Math.round(entitledQty * (1 - (0.1 + rand() * 0.3)))) // 10-40% short
      : entitledQty;
    beneficiaries.push({
      beneficiaryID: `${batchID}-BEN${b}`,
      entitledQty,
      actualQtyReceived,
      expectedComplaint: shortchange,
    });
  }

  batches.push({
    batchID,
    commodity: pick(COMMODITIES),
    manufacturerName: pick(MANUFACTURERS),
    manufacturingPlace: pick(PLACES),
    allocatedQty,
    dispatchedQty,
    sourceWarehouse: pick(WAREHOUSES),
    destinationShop: pick(SHOPS),
    receivedQty,
    expectedDiscrepancy: injectReceiveDiscrepancy,
    beneficiaries,
  });
}

const flaggedBatchCount = batches.filter((b) => b.expectedDiscrepancy).length;
const flaggedComplaintCount = batches.reduce(
  (sum, b) => sum + b.beneficiaries.filter((x) => x.expectedComplaint).length, 0
);

const dataset = {
  generatedAt: new Date().toISOString(),
  summary: {
    totalBatches: batches.length,
    batchesWithInjectedDiscrepancy: flaggedBatchCount,
    discrepancyRate: `${((flaggedBatchCount / batches.length) * 100).toFixed(1)}%`,
    beneficiarySalesWithInjectedShortchange: flaggedComplaintCount,
  },
  batches,
};

const outPath = path.join(__dirname, 'synthetic_dataset.json');
fs.writeFileSync(outPath, JSON.stringify(dataset, null, 2));

console.log(`Generated ${batches.length} batches (${flaggedBatchCount} with injected receive discrepancy).`);
console.log(`${flaggedComplaintCount} beneficiary sales injected with a shortchange.`);
console.log(`Written to ${outPath}`);
