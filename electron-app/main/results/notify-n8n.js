/**
 * POST del registro de la corrida al webhook de n8n. No lanza: devuelve el
 * resultado para que el llamador lo selle en record.n8n. `fetchImpl` se inyecta
 * en los tests; en producción usa el `fetch` global del Node del main.
 */
async function notifyN8n(record, { url, fetchImpl = fetch }) {
  const at = new Date().toISOString();
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (!res.ok) return { ok: false, at, error: `El servicio respondió ${res.status}` };
    return { ok: true, at, error: null };
  } catch (err) {
    return { ok: false, at, error: err.message || String(err) };
  }
}

module.exports = { notifyN8n };
