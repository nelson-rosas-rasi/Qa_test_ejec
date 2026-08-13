/**
 * POST del reporte al webhook de n8n. No lanza: devuelve el resultado para que
 * el llamador lo selle en `record.n8n`. `fetchImpl` se inyecta en los tests; en
 * producción usa el `fetch` global del Node del main.
 *
 * **Un 200 no alcanza para cantar victoria.** El nodo Webhook de n8n responde
 * apenas recibe, así que si un nodo posterior falla —plantilla que no existe,
 * credencial de Drive vencida, payload que no encaja— el POST vuelve 200 con el
 * cuerpo vacío y sin documento. Marcar eso como éxito le mostraba al QA
 * "documentación ✓" sobre un reporte inexistente. El envío cuenta sólo si n8n
 * devuelve el enlace del documento.
 */

/** n8n contesta con un array de un elemento; se acepta también el objeto suelto. */
function documentoDe(texto) {
  if (!texto || !texto.trim()) return null;
  let cuerpo;
  try { cuerpo = JSON.parse(texto); } catch { return null; }
  const primero = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;
  return (primero && primero.documentUrl) || null;
}

async function notifyN8n(payload, { url, fetchImpl = fetch }) {
  const at = new Date().toISOString();
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, at, docUrl: null, error: `El servicio respondió ${res.status}` };

    const docUrl = documentoDe(await res.text());
    if (!docUrl) {
      return {
        ok: false,
        at,
        docUrl: null,
        error: 'El servicio recibió la corrida pero no generó el documento. Revisá las ejecuciones en n8n.',
      };
    }
    return { ok: true, at, docUrl, error: null };
  } catch (err) {
    return { ok: false, at, docUrl: null, error: err.message || String(err) };
  }
}

module.exports = { notifyN8n };
