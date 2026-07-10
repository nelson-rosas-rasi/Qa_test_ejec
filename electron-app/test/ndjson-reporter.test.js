const test = require('node:test');
const assert = require('node:assert/strict');
const { plain } = require('../main/playwright/ndjson-reporter.cjs');

const ESC = String.fromCharCode(27);

test('plain elimina las secuencias ANSI completas, sin dejar el byte ESC', () => {
  const coloreado = `${ESC}[31mError${ESC}[39m: ${ESC}[2mexpect(${ESC}[22mrecibido).toBe`;
  const limpio = plain(coloreado);
  assert.equal(limpio, 'Error: expect(recibido).toBe');
  assert.ok(!limpio.includes(ESC), 'no debe quedar ningún byte de control');
});

test('plain deja intacto un texto sin colores', () => {
  assert.equal(plain('mensaje normal'), 'mensaje normal');
});
