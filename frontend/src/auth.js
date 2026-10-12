const BASE_URL = 'http://localhost:3000/api';
const STORAGE_KEY = 'rationtrace_auth';

export async function login(username, password) {
  const res = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || 'Login failed');
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(body));
  return body; // { token, role, username }
}

export function logout() {
  localStorage.removeItem(STORAGE_KEY);
}

function getSession() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function getToken() {
  return getSession()?.token || null;
}

export function getRole() {
  return getSession()?.role || null;
}

export function getUsername() {
  return getSession()?.username || null;
}

export function isLoggedIn() {
  return Boolean(getToken());
}
