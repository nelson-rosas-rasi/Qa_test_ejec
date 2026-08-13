const path = require('node:path');

/**
 * El guion que abre el botón «Hacerlo a mano».
 *
 * Nace de un caso real: el MSI de Node devolviendo 1603 en dos equipos, cuatro
 * intentos, dos días. Con `/qn` el instalador no muestra nada, así que el QA
 * queda parado y el líder recibe un código genérico. Los comandos de acá son
 * los mismos que corre el setup pero **sin las banderas silenciosas**: el
 * asistente gráfico se ve y el error deja de ser un número.
 *
 * El setup no espera nada de esta consola ni intenta adivinar si funcionó — no
 * puede, es un proceso suelto que maneja el QA. Después está el botón Verificar,
 * que vuelve a mirar el equipo.
 *
 * Puro: arma texto. Quien lo escribe y abre la consola es main.js.
 */

const TITULOS = {
  git: 'Herramienta para traer los proyectos (git)',
  node: 'Motor que instala las dependencias (Node)',
  browsers: 'Navegadores con los que se ejecutan las pruebas',
  runqa: 'RunQA',
};

/** cmd.exe corta en el primer espacio si la ruta no viene encomillada. */
const entrecomillar = (ruta) => `"${ruta}"`;

function comandoDe(id, { temp, prerequisites, releasesUrl }) {
  const enTemp = (url) => path.win32.join(temp, url.split('/').pop());
  if (id === 'git') {
    // Inno Setup: sin /VERYSILENT abre el asistente de siempre.
    return entrecomillar(enTemp(prerequisites.git.url));
  }
  if (id === 'node') {
    // Sin /qn: la interfaz del MSI dice qué falla donde el código 1603 no.
    return `msiexec /i ${entrecomillar(enTemp(prerequisites.node.url))} /norestart`;
  }
  if (id === 'browsers') {
    return `npx --yes playwright@${prerequisites.playwright.version} install`;
  }
  return `start "" ${entrecomillar(releasesUrl)}`;
}

/**
 * Los pasos que faltan, en orden, con el que falló primero. RunQA nunca se
 * saltea: es el sentido del setup, y si el QA llegó hasta acá conviene que
 * tenga a mano de dónde bajarlo.
 */
function pasosAMostrar(steps) {
  const fallado = steps.filter((paso) => paso.status === 'error');
  const pendientes = steps.filter((paso) => paso.status === 'pending');
  const resto = pendientes.filter((paso) => paso.id !== 'runqa');
  const runqa = steps.find((paso) => paso.id === 'runqa');
  const orden = [...fallado, ...resto.filter((p) => !fallado.some((f) => f.id === p.id))];
  if (runqa && !orden.some((paso) => paso.id === 'runqa')) orden.push(runqa);
  return orden;
}

function guionManual({ steps = [], temp, prerequisites, releasesUrl }) {
  const lineas = [
    '@echo off',
    'chcp 65001 > nul',
    'echo.',
    'echo  Instalacion manual de los requisitos de RunQA',
    'echo  ---------------------------------------------',
    'echo  Copia y pega cada comando, en orden. Se abren los asistentes',
    'echo  normales de Windows, que si explican que falla.',
    'echo  Cuando termines, volve al RunQA Setup y toca Verificar.',
    'echo.',
  ];

  for (const paso of pasosAMostrar(steps)) {
    lineas.push(`echo  == ${TITULOS[paso.id]}`);
    if (paso.status === 'error') lineas.push('echo  Este es el paso que fallo. Empeza por aca.');
    lineas.push(`echo  ${comandoDe(paso.id, { temp, prerequisites, releasesUrl })}`);
    lineas.push('echo.');
  }

  lineas.push(`cd /d "${temp}"`);
  return lineas.join('\r\n') + '\r\n';
}

module.exports = { guionManual, pasosAMostrar };
