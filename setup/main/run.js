const { planSteps, LABELS } = require('./steps');

/** Un paso sólo se da por hecho si la detección lo confirma. `runqa` no se
 *  verifica: lo instala el asistente de NSIS después de que el setup se cierra. */
const CONFIRMA = {
  git: (estado) => estado.git?.ok,
  node: (estado) => estado.node?.ok && estado.npm?.ok,
  browsers: (estado) => estado.browsers?.ok,
  runqa: () => true,
};

/**
 * Un único estado publicado por `publish`, igual que hace el updater de RunQA:
 * el renderer sólo pinta lo que llega y no decide nada.
 */
function createRunner({ detect, installers, publish }) {
  let steps = [];
  let current = null;
  let error = null;

  const emitir = () => publish({ steps: steps.map((s) => ({ ...s })), current, error });

  const marcar = (id, status, percent = 0) => {
    steps = steps.map((s) => (s.id === id ? { ...s, status, percent } : s));
    emitir();
  };

  async function ejecutar(id) {
    current = id;
    error = null;
    marcar(id, 'running');
    try {
      await installers[id]({ onProgress: (percent) => marcar(id, 'running', percent) });
      // Verificar: un instalador puede terminar sin error y no dejar el binario
      // donde corresponde. Se confirma releyendo el sistema, no confiando en el
      // código de salida.
      if (!CONFIRMA[id](await detect())) {
        error = `${LABELS[id]} no quedó instalado. Volvé a intentarlo.`;
        marcar(id, 'error');
        return false;
      }
      marcar(id, 'done', 100);
      return true;
    } catch (err) {
      error = err?.message || String(err);
      marcar(id, 'error');
      return false;
    } finally {
      current = null;
    }
  }

  return {
    async refresh() {
      const estado = await detect();
      steps = planSteps(estado).map((s) => ({ ...s, percent: s.status === 'done' ? 100 : 0 }));
      error = null;
      emitir();
    },

    async start() {
      for (const paso of steps.filter((s) => s.status !== 'done')) {
        const ok = await ejecutar(paso.id);
        if (!ok) return;
      }
    },

    async retry(id) {
      await ejecutar(id);
    },
  };
}

module.exports = { createRunner };
