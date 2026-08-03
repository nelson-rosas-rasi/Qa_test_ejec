const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('el instalador de Windows descarga el paquete y permite elegir la ruta', () => {
  assert.equal(pkg.build.win.target, 'nsis-web');
  assert.equal(pkg.build.nsis.oneClick, false);
  assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, true);
  assert.match(pkg.build.nsisWeb.artifactName, /Installer/);
});

test('el instalador ofrece abrir RunQA y crea accesos de desinstalación', () => {
  assert.equal(pkg.build.nsis.runAfterFinish, true);
  assert.equal(pkg.build.nsis.createDesktopShortcut, true);
  assert.equal(pkg.build.nsis.createStartMenuShortcut, true);
  assert.match(pkg.build.nsis.uninstallDisplayName, /RunQA/);
});
