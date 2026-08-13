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
/** Cuántas líneas de salida se conservan: alcanza para ver dónde se trabó. */
const MAX_SALIDA = 200;

function createRunner({ detect, installers, publish, onOutput = () => {} }) {
  let steps = [];
  let current = null;
  let error = null;
  let salida = [];
  let cancelacion = null;

  const emitir = () => publish({ steps: steps.map((s) => ({ ...s })), current, error, salida: [...salida] });

  /**
   * La salida real del instalador, línea a línea y en el momento. Antes sólo
   * había una barra que iba de 0 a 100 sin nada en el medio: `playwright
   * install` baja cientos de megas y la pantalla parecía congelada, sin forma de
   * distinguir "está trabajando" de "se colgó".
   */
  const registrar = (linea) => {
    const texto = String(linea).trimEnd();
    if (!texto) return;
    salida = [...salida, texto].slice(-MAX_SALIDA);
    onOutput(texto);
    emitir();
  };

  const marcar = (id, status, percent = 0) => {
    steps = steps.map((s) => (s.id === id ? { ...s, status, percent } : s));
    emitir();
  };

  const estadoDe = (id) => steps.find((paso) => paso.id === id)?.status;

  async function ejecutar(id) {
    current = id;
    error = null;
    salida = [];
    cancelacion = new AbortController();
    marcar(id, 'running');
    registrar(`> ${LABELS[id]}`);
    try {
      await installers[id]({
        onProgress: (percent) => marcar(id, 'running', percent),
        onOutput: registrar,
        signal: cancelacion.signal,
      });
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
      // Si el QA lo salteó mientras corría, el rechazo es la cancelación que
      // pidió: no es un fallo y la cadena sigue.
      if (estadoDe(id) === 'skipped') {
        registrar('Paso salteado por el usuario.');
        return true;
      }
      error = err?.message || String(err);
      marcar(id, 'error');
      return false;
    } finally {
      current = null;
      cancelacion = null;
    }
  }

  return {
    async refresh() {
      const estado = await detect();
      steps = planSteps(estado).map((s) => ({ ...s, percent: s.status === 'done' ? 100 : 0 }));
      error = null;
      emitir();
    },

    /**
     * Saltar un paso es una salida de emergencia, no una opción cualquiera:
     * el equipo queda sin ese requisito. RunQA no se puede saltar — es el
     * sentido del setup, y sin él el QA se queda sin la app.
     */
    skip(id) {
      if (id === 'runqa') return;
      const corriendo = current === id;
      marcar(id, 'skipped');
      // Marcarlo no alcanza si ya está corriendo: sin cortar el proceso, start()
      // sigue esperando un instalador que puede no volver nunca.
      if (corriendo && cancelacion) cancelacion.abort();
    },

    async start() {
      for (const paso of steps.filter((s) => s.status !== 'done' && s.status !== 'skipped')) {
        // Se relee el estado: el QA pudo saltear este paso mientras corría otro.
        if (estadoDe(paso.id) === 'skipped') continue;
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
