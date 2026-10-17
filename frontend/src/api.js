import { getToken } from './auth';

// const BASE_URL = 'http://localhost:3000/api';
const BASE_URL = 'http://localhost:3000/api';

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Request failed with status ${res.status}`);
  }
  return body;
}

export const api = {
  allocate: (data) => request('/allocate', { method: 'POST', body: JSON.stringify(data) }),
  dispatch: (data) => request('/dispatch', { method: 'POST', body: JSON.stringify(data) }),
  receive: (data) => request('/receive', { method: 'POST', body: JSON.stringify(data) }),
  reject: (data) => request('/reject', { method: 'POST', body: JSON.stringify(data) }),
  returnStock: (data) => request('/return', { method: 'POST', body: JSON.stringify(data) }),
  close: (data) => request('/close', { method: 'POST', body: JSON.stringify(data) }),
  sell: (data) => request('/sell', { method: 'POST', body: JSON.stringify(data) }),
  complaint: (data) => request('/complaint', { method: 'POST', body: JSON.stringify(data) }),
  getBatch: (batchID) => request(`/batch/${encodeURIComponent(batchID)}`),
  getDiscrepancies: () => request('/discrepancies'),
  getComplaints: () => request('/complaints'),
  getEntitlement: (beneficiaryID, batchID) =>
    request(`/entitlement/${encodeURIComponent(beneficiaryID)}/${encodeURIComponent(batchID)}`),
};
