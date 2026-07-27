/**
 * Drena la cola de corridas hacia el backend. No paraleliza: envía en orden y se
 * detiene ante el primer fallo recuperable (sin red, servidor caído) para
 * reintentar en la próxima pasada sin desordenar ni perder corridas. Un
 * UNAUTHORIZED también detiene: hace falta re-login.
 */
function createSender({ outbox, client, getToken, onChange = () => {} }) {
  let draining = false;

  async function drain() {
    if (draining) return { sent: 0, remaining: outbox.list().length, stoppedBy: 'BUSY' };
    draining = true;
    let sent = 0;
    let stoppedBy = null;
    try {
      for (const record of outbox.list()) {
        const token = getToken();
        if (!token) { stoppedBy = 'NO_TOKEN'; break; }
        const res = await client.postRun(token, record);
        if (res.ok) {
          outbox.remove(record.runId);
          sent++;
        } else if (res.code === 'UNAUTHORIZED') {
          stoppedBy = 'UNAUTHORIZED'; break;
        } else {
          stoppedBy = res.code || 'SERVER'; break;   // NETWORK / SERVER: reintentar luego
        }
      }
    } finally {
      draining = false;
    }
    if (sent > 0) onChange();
    return { sent, remaining: outbox.list().length, stoppedBy };
  }

  return { drain, pending: () => outbox.list().length };
}

module.exports = { createSender };
