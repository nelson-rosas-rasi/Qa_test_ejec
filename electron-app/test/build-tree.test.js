const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTree } = require('../main/playwright/build-tree');

/** Imita la forma real de `playwright test --list --reporter=json`. */
const LIST_JSON = {
  suites: [
    {
      title: 'alpha/mixed.spec.ts',
      specs: [],
      suites: [
        {
          title: 'operaciones',
          specs: [
            { title: 'resta', file: 'alpha/mixed.spec.ts', line: 4, column: 3 },
            { title: 'falla', file: 'alpha/mixed.spec.ts', line: 8, column: 3 },
          ],
        },
      ],
    },
    {
      title: 'alpha/ok.spec.ts',
      specs: [{ title: 'suma', file: 'alpha/ok.spec.ts', line: 3, column: 1 }],
      suites: [],
    },
    {
      title: 'slow.spec.ts',
      specs: [{ title: 'tarda mucho', file: 'slow.spec.ts', line: 3, column: 1 }],
      suites: [],
    },
  ],
  errors: [],
};

test('agrupa por carpeta y ordena alfabéticamente', () => {
  const tree = buildTree(LIST_JSON);
  assert.deepEqual(tree.map((s) => s.id), ['alpha', 'General']);
});

test('los archivos sin carpeta caen en General', () => {
  const general = buildTree(LIST_JSON).find((s) => s.id === 'General');
  assert.deepEqual(general.files.map((f) => f.name), ['slow.spec.ts']);
});

test('los ids de prueba son archivo:línea', () => {
  const alpha = buildTree(LIST_JSON).find((s) => s.id === 'alpha');
  const ok = alpha.files.find((f) => f.name === 'ok.spec.ts');
  assert.deepEqual(ok.tests, [{ id: 'alpha/ok.spec.ts:3', name: 'suma' }]);
});

test('el nombre de una prueba anidada incluye su describe', () => {
  const alpha = buildTree(LIST_JSON).find((s) => s.id === 'alpha');
  const mixed = alpha.files.find((f) => f.name === 'mixed.spec.ts');
  assert.deepEqual(mixed.tests.map((t) => t.name), ['operaciones > resta', 'operaciones > falla']);
});

test('el id del archivo es su ruta relativa', () => {
  const alpha = buildTree(LIST_JSON).find((s) => s.id === 'alpha');
  assert.deepEqual(alpha.files.map((f) => f.id), ['alpha/mixed.spec.ts', 'alpha/ok.spec.ts']);
});

test('errores de compilación lanzan LIST_FAILED con el detalle', () => {
  const broken = { suites: [], errors: [{ message: "Cannot find name 'foo'" }] };
  assert.throws(
    () => buildTree(broken),
    (err) => err.code === 'LIST_FAILED' && err.message.includes("Cannot find name 'foo'"),
  );
});

test('un repo sin pruebas devuelve un árbol vacío', () => {
  assert.deepEqual(buildTree({ suites: [], errors: [] }), []);
});
