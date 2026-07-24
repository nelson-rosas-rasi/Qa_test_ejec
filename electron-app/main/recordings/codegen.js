const { spawn } = require('node:child_process');

/**
 * Lanza Playwright codegen con el CLI del repo (para tener navegadores), cwd en el
 * repo, y escribe el test generado en `outFile`. Resuelve cuando el usuario cierra
 * el grabador. Necesita display (abre un navegador): se prueba con smoke manual.
 */
function record({ cliPath, repoPath, url, outFile, nodePath = process.execPath }) {
  return new Promise((resolve) => {
    const args = [cliPath, 'codegen', '--target', 'playwright-test', '--output', outFile];
    if (url) args.push(url);
    const child = spawn(nodePath, args, {
      cwd: repoPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('close', (code) => resolve({ ok: code === 0, code }));
    child.on('error', (err) => resolve({ ok: false, error: err.message || String(err) }));
  });
}

module.exports = { record };
