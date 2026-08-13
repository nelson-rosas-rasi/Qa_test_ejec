const path = require('node:path');

/**
 * Dónde viven los clones de los proyectos.
 *
 * Hasta ahora era una ruta fija bajo `userData`: la cuenta de Windows decidía en
 * qué disco quedaban los `node_modules` de cada repo, y el QA no tenía voz ni
 * sabía dónde buscarlos. Ahora elige la carpeta raíz.
 *
 * Cambiar de raíz **no mueve nada**: los proyectos que ya existen se siguen
 * administrando donde están. Por eso no hay una raíz sino un conjunto, y la
 * comprobación de "esto lo administra RunQA" pregunta por todas. Sin eso, el
 * primer cambio de carpeta dejaría a los proyectos viejos sin poder actualizarse
 * ni borrarse.
 *
 * Puro: sin fs, sin Electron.
 */

/** La carpeta que se usa para los proyectos nuevos. */
function resolveProjectsRoot({ configured, userData }) {
  const elegida = String(configured || '').trim();
  return elegida || path.join(userData, 'projects');
}

/** La actual primero, después la de siempre y las que se usaron antes. */
function knownRoots({ configured, userData, previos = [] }) {
  const todas = [
    resolveProjectsRoot({ configured, userData }),
    path.join(userData, 'projects'),
    ...previos,
  ];
  return [...new Set(todas.map((ruta) => path.resolve(ruta)))];
}

/**
 * `remove()` borra la carpeta, así que esto tiene que ser estricto: se compara
 * con el separador al final para que "/datos/qa2" no pase por estar dentro de
 * "/datos/qa", y la raíz pelada no cuenta como proyecto.
 */
function isManaged(repoPath, roots = []) {
  const candidato = path.resolve(repoPath) + path.sep;
  return roots.some((raiz) => {
    const base = path.resolve(raiz) + path.sep;
    return candidato !== base && candidato.startsWith(base);
  });
}

module.exports = { resolveProjectsRoot, knownRoots, isManaged };
