const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveProjectsRoot, knownRoots, isManaged } = require('../main/projects-root');

const USER_DATA = path.join('/home', 'qa', '.config', 'RunQA');
const POR_DEFECTO = path.join(USER_DATA, 'projects');

test('sin carpeta elegida, los proyectos van bajo los datos de la app', () => {
  assert.equal(resolveProjectsRoot({ userData: USER_DATA }), POR_DEFECTO);
});

test('la carpeta elegida por el QA manda', () => {
  assert.equal(resolveProjectsRoot({ configured: '/datos/qa', userData: USER_DATA }), '/datos/qa');
});

test('una carpeta elegida en blanco no pisa el valor por defecto', () => {
  assert.equal(resolveProjectsRoot({ configured: '   ', userData: USER_DATA }), POR_DEFECTO);
});

test('las raíces conocidas incluyen la actual y las anteriores', () => {
  // Cambiar de carpeta no puede dejar huérfanos los proyectos ya creados: se
  // siguen administrando desde donde están.
  const roots = knownRoots({ configured: '/datos/qa', userData: USER_DATA, previos: ['/viejo/qa'] });
  assert.deepEqual(roots, ['/datos/qa', POR_DEFECTO, '/viejo/qa']);
});

test('las raíces no se repiten aunque la elegida sea la de siempre', () => {
  const roots = knownRoots({ configured: POR_DEFECTO, userData: USER_DATA, previos: [POR_DEFECTO] });
  assert.deepEqual(roots, [POR_DEFECTO]);
});

test('un repo bajo alguna raíz conocida está administrado', () => {
  assert.equal(isManaged(path.join('/datos/qa', 'erp'), ['/otra', '/datos/qa']), true);
});

test('un repo fuera de toda raíz no está administrado', () => {
  assert.equal(isManaged('/home/qa/Escritorio/erp', ['/datos/qa']), false);
});

test('una carpeta hermana con el mismo prefijo no cuenta como administrada', () => {
  // "/datos/qa2" empieza con "/datos/qa": comparar textos sueltos lo daría por
  // adentro, y remove() borra carpetas.
  assert.equal(isManaged('/datos/qa2/erp', ['/datos/qa']), false);
});

test('la raíz misma no es un proyecto administrado', () => {
  assert.equal(isManaged('/datos/qa', ['/datos/qa']), false);
});
