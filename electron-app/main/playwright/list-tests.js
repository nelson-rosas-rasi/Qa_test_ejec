const { execFile } = require('node:child_process');
const { buildTree } = require('./build-tree');
const { appError } = require('../errors');

/**
 * `nodePath` es `process.execPath`: en la app es el binario de Electron, que con
 * ELECTRON_RUN_AS_NODE=1 se comporta como Node. Así el QA no necesita Node instalado.
 */
function listTests({ repoPath, cliPath, nodePath = process.execPath }) {
  return new Promise((resolve, reject) => {
    execFile(
      nodePath,
      [cliPath, 'test', '--list', '--reporter=json'],
      {
        cwd: repoPath,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (!stdout) {
          return reject(appError('LIST_FAILED', (stderr || '').trim() || err?.message || 'Playwright no respondió.'));
        }
        // El config del repo puede imprimir antes del JSON; empezamos en la primera llave.
        const start = stdout.indexOf('{');
        if (start === -1) {
          return reject(appError('LIST_FAILED', 'Playwright no devolvió el listado de pruebas.'));
        }
        try {
          resolve(buildTree(JSON.parse(stdout.slice(start))));
        } catch (parseErr) {
          reject(parseErr.code ? parseErr : appError('LIST_FAILED', parseErr.message));
        }
      },
    );
  });
}

module.exports = { listTests };
