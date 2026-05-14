/**
 * Tiny fetch wrapper that auto-attaches the JWT and parses JSON errors.
 * Token is stored in localStorage under "mcpanel.token".
 */
const TOKEN_KEY = 'mcpanel.token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Perform a JSON API request. Throws on non-2xx with the server's error message.
 * @param {string} pathname e.g. "/api/servers"
 * @param {RequestInit} [options]
 */
export async function api(pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const resp = await fetch(pathname, { ...options, headers });
  if (resp.status === 401) {
    clearToken();
    // Soft reload to bounce to login
    if (!pathname.endsWith('/auth/login')) {
      window.dispatchEvent(new CustomEvent('mcpanel:unauthorized'));
    }
  }
  const contentType = resp.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await resp.json().catch(() => null);
  } else {
    data = await resp.text().catch(() => '');
  }
  if (!resp.ok) {
    const message = (data && data.error) || (typeof data === 'string' && data) || `HTTP ${resp.status}`;
    const err = new Error(message);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Helper for binary downloads — opens a new tab with the auth token in the URL. */
export function buildDownloadUrl(path) {
  const t = getToken();
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}token=${encodeURIComponent(t || '')}`;
}
