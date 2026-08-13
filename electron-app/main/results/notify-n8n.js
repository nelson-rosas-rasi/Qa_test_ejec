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

/**
 * El cuerpo se guarda en el registro de la corrida y se le muestra al QA, así que
 * una respuesta enorme (un stack de n8n, un HTML de error) no puede engordar el
 * JSON sin límite.
 */
const TOPE_CUERPO = 2000;

function recortar(texto) {
  if (texto === null || texto === undefined) return null;
  const s = String(texto);
  return s.length <= TOPE_CUERPO ? s : `${s.slice(0, TOPE_CUERPO)}\n… (respuesta recortada)`;
}

async function notifyN8n(payload, { url, fetchImpl = fetch }) {
  const at = new Date().toISOString();
  let status = null;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    status = res.status ?? null;

    // El cuerpo se lee siempre, falle o no: es lo único que dice QUÉ salió mal
    // cuando el flujo está mal configurado. Se recorta sólo para mostrarlo; el
    // enlace se busca en el texto completo, o una respuesta larga pero buena
    // quedaría marcada como fallida.
    const crudo = await res.text();
    const body = recortar(crudo);
    if (!res.ok) return { ok: false, at, docUrl: null, status, body, error: `El servicio respondió ${res.status}` };

    const docUrl = documentoDe(crudo);
    if (!docUrl) {
      return {
        ok: false,
        at,
        docUrl: null,
        status,
        body,
        error: 'El servicio recibió la corrida pero no generó el documento. Revisá las ejecuciones en n8n.',
      };
    }
    return { ok: true, at, docUrl, status, body, error: null };
  } catch (err) {
    return { ok: false, at, docUrl: null, status, body: null, error: err.message || String(err) };
  }
}

module.exports = { notifyN8n };
