/**
 * Cliente HTTP del backend qa-reports. No lanza por errores de red: devuelve un
 * resultado uniforme para que la cola y el sender decidan reintentar. `fetchImpl`
 * se inyecta en los tests (igual que notify-n8n.js).
 */
function createServerClient({ baseUrl, fetchImpl = fetch }) {
  const url = (path) => `${String(baseUrl).replace(/\/$/, '')}${path}`;

  async function call(path, { method = 'POST', token = null, body = null } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const res = await fetchImpl(url(path), { method, headers, body: body ? JSON.stringify(body) : undefined });
      let data = null;
      if (res.status !== 204) { try { data = await res.json(); } catch { data = null; } }
      return { res, data };
    } catch (err) {
      return { networkError: err.message || String(err) };
    }
  }

  return {
    async login(username, password) {
      const { res, data, networkError } = await call('/api/auth/login', { body: { username, password } });
      if (networkError) return { ok: false, code: 'NETWORK', error: networkError };
      if (res.status === 401) return { ok: false, code: 'BAD_CREDENTIALS', error: (data && data.message) || 'Credenciales incorrectas' };
      if (!res.ok || !data?.data?.token) return { ok: false, status: res.status, error: (data && data.message) || 'No se pudo iniciar sesión.' };
      const d = data.data;
      return { ok: true, token: d.token, user: { username: d.username, fullName: d.fullName, role: d.role } };
    },

    async postRun(token, record) {
      const { res, networkError } = await call('/api/runs', { token, body: record });
      if (networkError) return { ok: false, code: 'NETWORK', error: networkError };
      if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, code: 'UNAUTHORIZED', error: 'La sesión no es válida.' };
      if (res.status === 204) return { ok: true, created: false };
      if (res.ok) return { ok: true, created: true };
      return { ok: false, status: res.status, code: 'SERVER', error: `El servidor respondió ${res.status}` };
    },

    async syncModules(token, payload) {
      const { res, networkError } = await call('/api/sync/modules', { token, body: payload });
      if (networkError) return { ok: false, code: 'NETWORK', error: networkError };
      if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, code: 'UNAUTHORIZED' };
      if (res.ok) return { ok: true };
      return { ok: false, status: res.status, code: 'SERVER', error: `El servidor respondió ${res.status}` };
    },
  };
}

module.exports = { createServerClient };
