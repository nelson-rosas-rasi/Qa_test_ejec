/**
 * Arma la línea que el registro escribe cada vez que el setup mira el equipo.
 *
 * Existe por un caso real: un MSI de Node devolviendo 1603 en dos equipos, y el
 * registro no permitía saber si Node ya estaba instalado —porque sólo se
 * escribían los errores—. Sin eso no se distingue "el equipo no lo tiene" de
 * "lo tiene, pero no para la cuenta con la que se elevó el setup", que llevan a
 * arreglos opuestos. Por eso la procedencia va en la línea: una ruta bajo el
 * perfil de otro usuario, o un `node` pelado del PATH, cuentan la historia.
 *
 * Puro: recibe el estado de `detect()` y devuelve texto.
 */

/** Un prerequisito resuelto por `probe`: versión, procedencia y por qué no sirve. */
function describir(nombre, estado) {
  if (!estado || !estado.version) return `${nombre} FALTA`;
  const desde = estado.desde ? ` (${estado.desde})` : '';
  if (estado.ok) return `${nombre} ${estado.version}${desde}`;
  if (estado.reason === 'outdated') {
    return `${nombre} ${estado.version} OBSOLETO, se pide ${estado.minVersion}${desde}`;
  }
  return `${nombre} FALTA`;
}

/** Los navegadores no son un binario: no tienen procedencia, sí un marcador. */
function describirNavegadores(browsers) {
  if (browsers?.ok) return `navegadores ${browsers.version}`;
  if (browsers?.version) return `navegadores FALTAN (el marcador dice ${browsers.version})`;
  return 'navegadores FALTAN';
}

function lineaDeDeteccion(estado = {}) {
  return [
    'detectado: ' + describir('git', estado.git),
    describir('node', estado.node),
    describir('npm', estado.npm),
    describirNavegadores(estado.browsers),
  ].join(' · ');
}

/**
 * Primera línea de cada arranque. La cuenta es lo que decide cómo leer todo lo
 * demás: si el setup se elevó con credenciales ajenas, `%ProgramFiles%` y el
 * PATH que mira la detección son los de ese otro perfil, y lo que el QA tenga
 * instalado en el suyo es invisible.
 */
function lineaDeEntorno({ version, usuario, temp }) {
  return `RunQA Setup ${version} · cuenta: ${usuario || 'desconocida'} · temp: ${temp || 'desconocida'}`;
}

module.exports = { lineaDeDeteccion, lineaDeEntorno };
