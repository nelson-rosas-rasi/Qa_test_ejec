const test = require('node:test');
const assert = require('node:assert/strict');
const { lineaDeDeteccion, lineaDeEntorno } = require('../main/diagnostico');

const TODO_OK = {
  git: { ok: true, version: '2.51.0', desde: 'C:\\Program Files\\Git\\cmd\\git.exe' },
  node: { ok: true, version: '22.21.0', desde: 'C:\\Program Files\\nodejs\\node.exe' },
  npm: { ok: true, version: '10.9.0', desde: 'npm.cmd' },
  browsers: { ok: true, version: '1.58.2' },
};

test('con todo instalado nombra versión y procedencia de cada uno', () => {
  assert.equal(
    lineaDeDeteccion(TODO_OK),
    'detectado: git 2.51.0 (C:\\Program Files\\Git\\cmd\\git.exe) · '
    + 'node 22.21.0 (C:\\Program Files\\nodejs\\node.exe) · '
    + 'npm 10.9.0 (npm.cmd) · navegadores 1.58.2',
  );
});

test('lo que no se encontró se nombra como FALTA, sin procedencia', () => {
  const linea = lineaDeDeteccion({ ...TODO_OK, node: { ok: false, version: null, desde: null } });
  assert.match(linea, /node FALTA/);
  assert.doesNotMatch(linea, /node FALTA \(/);
});

test('una versión vieja se distingue de una ausente y dice cuál se pide', () => {
  const linea = lineaDeDeteccion({
    ...TODO_OK,
    node: { ok: false, version: '18.4.0', desde: 'C:\\nvm\\node.exe', reason: 'outdated', minVersion: '20.0.0' },
  });
  assert.match(linea, /node 18\.4\.0 OBSOLETO, se pide 20\.0\.0 \(C:\\nvm\\node\.exe\)/);
});

test('navegadores sin instalar', () => {
  const linea = lineaDeDeteccion({ ...TODO_OK, browsers: { ok: false, version: null } });
  assert.match(linea, /navegadores FALTAN$/);
});

test('el marcador de navegadores se informa cuando no coincide con la caché', () => {
  const linea = lineaDeDeteccion({ ...TODO_OK, browsers: { ok: false, version: '1.57.0' } });
  assert.match(linea, /navegadores FALTAN \(el marcador dice 1\.57\.0\)$/);
});

test('un estado incompleto no rompe el registro', () => {
  assert.match(lineaDeDeteccion({}), /git FALTA/);
});

test('la línea de arranque nombra versión, cuenta y carpeta temporal', () => {
  // La cuenta es la evidencia de si el setup se elevó con credenciales ajenas:
  // ahí las rutas conocidas y el PATH son las de otro perfil.
  assert.equal(
    lineaDeEntorno({ version: '1.0.2', usuario: 'Infraestructura', temp: 'C:\\Users\\INFRAE~1\\AppData\\Local\\Temp' }),
    'RunQA Setup 1.0.2 · cuenta: Infraestructura · temp: C:\\Users\\INFRAE~1\\AppData\\Local\\Temp',
  );
});

test('si no se puede saber la cuenta, lo dice en vez de mentir', () => {
  assert.match(lineaDeEntorno({ version: '1.0.2', usuario: null, temp: null }), /cuenta: desconocida · temp: desconocida/);
});
