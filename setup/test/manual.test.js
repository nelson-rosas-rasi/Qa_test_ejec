const test = require('node:test');
const assert = require('node:assert/strict');
const { guionManual } = require('../main/manual');

const PREREQ = {
  git: { url: 'https://github.com/x/Git-2.55.0.3-64-bit.exe' },
  node: { url: 'https://nodejs.org/dist/v22.23.2/node-v22.23.2-x64.msi' },
  playwright: { version: '1.58.2' },
};
const ENTORNO = { temp: 'C:\\Users\\qa\\AppData\\Local\\Temp', prerequisites: PREREQ, releasesUrl: 'https://github.com/x/y/releases' };

const pasos = (estados) => ['git', 'node', 'browsers', 'runqa'].map((id, i) => ({ id, status: estados[i] }));

test('sólo aparecen los pasos que faltan', () => {
  const guion = guionManual({ ...ENTORNO, steps: pasos(['done', 'pending', 'pending', 'pending']) });
  assert.doesNotMatch(guion, /Git-2\.55/);
  assert.match(guion, /node-v22\.23\.2-x64\.msi/);
});

test('el instalador de Node se ofrece SIN /qn, que es lo que oculta el error', () => {
  const guion = guionManual({ ...ENTORNO, steps: pasos(['done', 'pending', 'done', 'pending']) });
  assert.match(guion, /msiexec \/i "C:\\Users\\qa\\AppData\\Local\\Temp\\node-v22\.23\.2-x64\.msi" \/norestart/);
  assert.doesNotMatch(guion, /\/qn/);
});

test('el paso que falló va primero y con un encabezado que lo nombra', () => {
  const guion = guionManual({
    ...ENTORNO,
    steps: [
      { id: 'git', status: 'pending' },
      { id: 'node', status: 'error' },
      { id: 'browsers', status: 'pending' },
      { id: 'runqa', status: 'pending' },
    ],
  });
  const posNode = guion.indexOf('node-v22.23.2-x64.msi');
  const posGit = guion.indexOf('Git-2.55.0.3-64-bit.exe');
  assert.ok(posNode < posGit, 'el paso fallado tiene que ir antes');
  // Sin tilde a propósito: el guion se escribe en ASCII porque la consola de
  // Windows lo muestra según la página de códigos del equipo, y una tilde mal
  // decodificada en el mensaje de ayuda es ruido justo cuando el QA está trabado.
  assert.match(guion, /Este es el paso que fallo/);
});

test('instalar RunQA aparece siempre, aunque no falte nada', () => {
  const guion = guionManual({ ...ENTORNO, steps: pasos(['done', 'done', 'done', 'done']) });
  assert.match(guion, /releases/);
});

test('los navegadores se instalan con la versión fijada', () => {
  const guion = guionManual({ ...ENTORNO, steps: pasos(['done', 'done', 'pending', 'pending']) });
  assert.match(guion, /npx --yes playwright@1\.58\.2 install/);
});

test('las rutas van entre comillas: %TEMP% del QA puede tener espacios', () => {
  const guion = guionManual({
    ...ENTORNO,
    temp: 'C:\\Users\\Juan Perez\\AppData\\Local\\Temp',
    steps: pasos(['pending', 'done', 'done', 'done']),
  });
  assert.match(guion, /"C:\\Users\\Juan Perez\\AppData\\Local\\Temp\\Git-2\.55\.0\.3-64-bit\.exe"/);
});

test('el guion deja la consola abierta y explica de qué se trata', () => {
  const guion = guionManual({ ...ENTORNO, steps: pasos(['pending', 'pending', 'pending', 'pending']) });
  assert.match(guion, /@echo off/);
  assert.match(guion, /copia y pega/i);
});
