// Sends a JSON payload to an output destination (API endpoint + token) directly from the browser.
export function buildHeaders(dest) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*' };
  if (dest.authType === 'bearer' && dest.token) headers.Authorization = `Bearer ${dest.token}`;
  if (dest.authType === 'header' && dest.token && dest.headerName) headers[dest.headerName] = dest.token;
  for (const h of dest.extraHeaders || []) if (h.name?.trim()) headers[h.name.trim()] = h.value ?? '';
  return headers;
}

export async function sendJson(dest, payload) {
  if (!dest?.url) throw new Error('The destination has no URL.');
  const started = Date.now();
  let res;
  try {
    res = await fetch(dest.url, { method: dest.method || 'POST', headers: buildHeaders(dest), body: JSON.stringify(payload) });
  } catch (e) {
    throw new Error(
      `Request to ${dest.url} failed before a response was received (${e.message}). The endpoint must be reachable from this browser and allow CORS requests from this app's origin (${location.origin}).`,
    );
  }
  const body = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, statusText: res.statusText, body: body.slice(0, 2000), ms: Date.now() - started };
}
