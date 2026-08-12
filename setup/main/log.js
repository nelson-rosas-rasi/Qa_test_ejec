const fs = require('node:fs');
const path = require('node:path');

/** Registro plano para poder pedirle al QA "mandame el archivo" cuando algo falla. */
function createLog(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'setup.log');
  const write = (linea) => fs.appendFileSync(file, `[${new Date().toISOString()}] ${linea}\n`);
  return { file, write };
}

module.exports = { createLog };
