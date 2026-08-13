const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectManager, parseDefaultBranch, uniqueProjectId, validateManagedPath } = require('../main/projects');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-projects-'));

test('detecta la rama principal informada por el remoto', () => {
  assert.equal(parseDefaultBranch('ref: refs/heads/trunk\tHEAD\nabc\tHEAD\n'), 'trunk');
});

test('genera ids estables y evita duplicados', () => {
  assert.equal(uniqueProjectId('Médico ERP', new Set()), 'medico-erp');
  assert.equal(uniqueProjectId('ERP', new Set(['erp', 'erp-2'])), 'erp-3');
});

test('rechaza repositorios fuera de la carpeta administrada', () => {
  const root = temp();
  assert.throws(() => validateManagedPath(path.join(root, '..', 'personal'), root), (err) => err.code === 'UNMANAGED_REPOSITORY');
});

test('prepara el clon en detached HEAD de la rama remota', async () => {
  const projectsDir = temp();
  const repoPath = path.join(projectsDir, 'erp');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'node_modules', 'playwright'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'node_modules', 'playwright', 'cli.js'), '');
  fs.writeFileSync(path.join(repoPath, 'package-lock.json'), '{"lockfileVersion":3}');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(repoPath, 'package-lock.json'))).digest('hex');
  const calls = [];
  const run = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    if (args[0] === 'ls-remote') return { stdout: 'ref: refs/heads/main\tHEAD\nabc\tHEAD\n', stderr: '' };
    if (args[0] === 'remote') return { stdout: 'https://example.test/qa.git\n', stderr: '' };
    if (args[0] === 'rev-parse') return { stdout: 'abc123\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const manager = createProjectManager({ projectsDir, run });
  const result = await manager.prepare({ repoPath, repoUrl: 'https://example.test/qa.git', defaultBranch: 'main', dependencyLockHash: hash });
  assert.equal(result.commit, 'abc123');
  assert.deepEqual(calls.map((call) => call.args), [
    ['ls-remote', '--symref', 'https://example.test/qa.git', 'HEAD'],
    ['remote', 'get-url', 'origin'],
    ['fetch', '--prune', 'origin', '+refs/heads/main:refs/remotes/origin/main'],
    ['checkout', '--detach', 'origin/main'],
    ['reset', '--hard', 'origin/main'],
    ['clean', '-fd'],
    ['rev-parse', 'HEAD'],
  ]);
});

test('checkStatus reporta cuántos commits hay por traer del remoto', async () => {
  const projectsDir = temp();
  const repoPath = path.join(projectsDir, 'erp');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  const calls = [];
  const run = async (command, args, options = {}) => {
    calls.push({ args, cwd: options.cwd });
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'local111\n', stderr: '' };
    if (args[0] === 'rev-parse') return { stdout: 'remote222\n', stderr: '' };
    if (args[0] === 'rev-list') return { stdout: '3\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const manager = createProjectManager({ projectsDir, run });
  const status = await manager.checkStatus({ repoPath, repoUrl: 'https://example.test/qa.git', defaultBranch: 'main' });
  assert.equal(status.updateAvailable, true);
  assert.equal(status.behind, 3);
  assert.deepEqual(calls.map((call) => call.args), [
    ['fetch', '--prune', 'origin', '+refs/heads/main:refs/remotes/origin/main'],
    ['rev-parse', 'HEAD'],
    ['rev-parse', 'refs/remotes/origin/main'],
    ['rev-list', '--count', 'HEAD..refs/remotes/origin/main'],
  ]);
});

test('checkStatus marca "al día" cuando local y remoto coinciden', async () => {
  const projectsDir = temp();
  const repoPath = path.join(projectsDir, 'erp');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  const run = async (command, args) => {
    if (args[0] === 'rev-parse') return { stdout: 'samecommit\n', stderr: '' };
    if (args[0] === 'rev-list') return { stdout: '0\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const status = await createProjectManager({ projectsDir, run })
    .checkStatus({ repoPath, repoUrl: 'https://example.test/qa.git', defaultBranch: 'main' });
  assert.equal(status.updateAvailable, false);
  assert.equal(status.behind, 0);
});

test('importa un clon local sin modificar la carpeta original', async () => {
  const projectsDir = temp();
  const sourcePath = temp();
  fs.mkdirSync(path.join(sourcePath, '.git'));
  fs.writeFileSync(path.join(sourcePath, 'cambio-sin-commit.txt'), 'no tocar');
  const calls = [];
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, cwd: options.cwd });
    if (args[0] === 'remote' && args[1] === 'get-url') return { stdout: 'https://example.test/local.git\n', stderr: '' };
    if (args[0] === 'ls-remote') return { stdout: 'ref: refs/heads/main\tHEAD\nabc\tHEAD\n', stderr: '' };
    if (args[0] === 'clone') {
      const destination = args.at(-1);
      fs.mkdirSync(destination, { recursive: true });
      fs.writeFileSync(path.join(destination, 'package.json'), '{}');
      fs.writeFileSync(path.join(destination, 'package-lock.json'), '{"lockfileVersion":3}');
      return { stdout: '', stderr: '' };
    }
    if (args[0] === 'ci') {
      fs.mkdirSync(path.join(options.cwd, 'node_modules', 'playwright'), { recursive: true });
      fs.writeFileSync(path.join(options.cwd, 'node_modules', 'playwright', 'cli.js'), '');
      return { stdout: '', stderr: '' };
    }
    if (args[0] === 'rev-parse') return { stdout: 'abc123\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const manager = createProjectManager({ projectsDir, run });
  const project = await manager.importExisting({ id: 'local', sourcePath });
  assert.equal(project.repoUrl, 'https://example.test/local.git');
  assert.equal(project.defaultBranch, 'main');
  assert.equal(fs.readFileSync(path.join(sourcePath, 'cambio-sin-commit.txt'), 'utf8'), 'no tocar');
  assert.equal(calls.some((call) => call.cwd === sourcePath && ['reset', 'clean', 'checkout'].includes(call.args[0])), false);
});
test('acepta un repositorio local sin origin', async () => {
  const projectsDir = temp();
  const sourcePath = temp();
  fs.mkdirSync(path.join(sourcePath, '.git'));
  const run = async (_command, args, options = {}) => {
    if (args[0] === 'remote' && args[1] === 'get-url') throw Object.assign(new Error('sin origin'), { code: 2 });
    if (args[0] === 'ls-remote') return { stdout: 'ref: refs/heads/RamaCas\tHEAD\nabc\tHEAD\n', stderr: '' };
    if (args[0] === 'clone') {
      const destination = args.at(-1);
      fs.mkdirSync(destination, { recursive: true });
      fs.writeFileSync(path.join(destination, 'package.json'), '{}');
      fs.writeFileSync(path.join(destination, 'package-lock.json'), '{"lockfileVersion":3}');
    }
    if (args[0] === 'ci') {
      fs.mkdirSync(path.join(options.cwd, 'node_modules', 'playwright'), { recursive: true });
      fs.writeFileSync(path.join(options.cwd, 'node_modules', 'playwright', 'cli.js'), '');
    }
    if (args[0] === 'rev-parse') return { stdout: 'local123\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const project = await createProjectManager({ projectsDir, run }).importExisting({ id: 'local', sourcePath });
  assert.equal(project.repoUrl, sourcePath);
  assert.equal(project.defaultBranch, 'RamaCas');
});

test('git se invoca con la credencial de la cuenta conectada', async () => {
  const projectsDir = temp();
  const repoPath = path.join(projectsDir, 'erp');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'node_modules', 'playwright'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'node_modules', 'playwright', 'cli.js'), '');
  fs.writeFileSync(path.join(repoPath, 'package-lock.json'), '{"lockfileVersion":3}');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(repoPath, 'package-lock.json'))).digest('hex');
  const calls = [];
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, env: options.env });
    if (args.includes('ls-remote')) return { stdout: 'ref: refs/heads/main\tHEAD\nabc\tHEAD\n', stderr: '' };
    if (args.includes('remote')) return { stdout: 'https://example.test/qa.git\n', stderr: '' };
    if (args.includes('rev-parse')) return { stdout: 'abc123\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const auth = { args: () => ['-c', 'credential.x=y'], env: () => ({ QA_GH_TOKEN: 'tok' }) };
  const manager = createProjectManager({ projectsDir, run, auth });
  await manager.prepare({ repoPath, repoUrl: 'https://example.test/qa.git', defaultBranch: 'main', dependencyLockHash: hash });
  assert.deepEqual(calls[0].args.slice(0, 2), ['-c', 'credential.x=y']);
  assert.equal(calls[0].env.QA_GH_TOKEN, 'tok');
});

test('sin cuenta conectada, git se invoca igual que siempre', async () => {
  const projectsDir = temp();
  const calls = [];
  const run = async (_command, args) => {
    calls.push(args);
    if (args[0] === 'ls-remote') return { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  await createProjectManager({ projectsDir, run })
    .initialize({ id: 'x', name: 'X', repoUrl: 'https://example.test/qa.git' })
    .catch(() => {});
  assert.deepEqual(calls[0], ['ls-remote', '--symref', 'https://example.test/qa.git', 'HEAD']);
});

test('un repositorio privado sin acceso se traduce a REPOSITORY_ACCESS_DENIED', async () => {
  const run = async () => {
    throw Object.assign(new Error('Command failed'), {
      stderr: "remote: Repository not found.\nfatal: repository 'https://github.com/equipo/pruebas.git/' not found",
    });
  };
  await assert.rejects(
    createProjectManager({ projectsDir: temp(), run })
      .initialize({ id: 'x', name: 'X', repoUrl: 'https://github.com/equipo/pruebas.git' }),
    (err) => err.code === 'REPOSITORY_ACCESS_DENIED',
  );
});

test('una credencial rechazada también se traduce a REPOSITORY_ACCESS_DENIED', async () => {
  const run = async () => {
    throw Object.assign(new Error('Command failed'), {
      stderr: 'fatal: Authentication failed for https://github.com/equipo/pruebas.git/',
    });
  };
  await assert.rejects(
    createProjectManager({ projectsDir: temp(), run })
      .initialize({ id: 'x', name: 'X', repoUrl: 'https://github.com/equipo/pruebas.git' }),
    (err) => err.code === 'REPOSITORY_ACCESS_DENIED',
  );
});

test('otros fallos de git conservan su mensaje de siempre', async () => {
  const run = async () => {
    throw Object.assign(new Error('Command failed'), { stderr: 'fatal: unable to access: SSL certificate problem' });
  };
  await assert.rejects(
    createProjectManager({ projectsDir: temp(), run })
      .initialize({ id: 'x', name: 'X', repoUrl: 'https://github.com/equipo/pruebas.git' }),
    (err) => err.code === 'REPOSITORY_UNAVAILABLE',
  );
});
test('npm.cmd se invoca con shell: Node >=20.12 se niega a ejecutar .cmd sin él', async () => {
  const projectsDir = temp();
  const sourcePath = temp();
  fs.mkdirSync(path.join(sourcePath, '.git'));
  const calls = [];
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, options });
    if (args.includes('remote') && args.includes('get-url')) return { stdout: 'https://example.test/qa.git\n', stderr: '' };
    if (args.includes('ls-remote')) return { stdout: 'ref: refs/heads/main\tHEAD\nabc\tHEAD\n', stderr: '' };
    if (args.includes('clone')) {
      const destination = args.at(-1);
      fs.mkdirSync(destination, { recursive: true });
      fs.writeFileSync(path.join(destination, 'package.json'), '{}');
      fs.writeFileSync(path.join(destination, 'package-lock.json'), '{"lockfileVersion":3}');
      return { stdout: '', stderr: '' };
    }
    if (args[0] === 'ci') {
      fs.mkdirSync(path.join(options.cwd, 'node_modules', 'playwright'), { recursive: true });
      fs.writeFileSync(path.join(options.cwd, 'node_modules', 'playwright', 'cli.js'), '');
      return { stdout: '', stderr: '' };
    }
    if (args.includes('rev-parse')) return { stdout: 'abc123\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  await createProjectManager({ projectsDir, run, npmPath: 'npm.cmd' }).importExisting({ id: 'local', sourcePath });
  const npmCall = calls.find((call) => call.command === 'npm.cmd');
  assert.equal(npmCall.options.shell, true);
});

test('un npm con espacios en la ruta llega encomillado al shell', async () => {
  const projectsDir = temp();
  const sourcePath = temp();
  fs.mkdirSync(path.join(sourcePath, '.git'));
  const calls = [];
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, options });
    if (args.includes('remote') && args.includes('get-url')) return { stdout: 'https://example.test/qa.git\n', stderr: '' };
    if (args.includes('ls-remote')) return { stdout: 'ref: refs/heads/main\tHEAD\nabc\tHEAD\n', stderr: '' };
    if (args.includes('clone')) {
      const destination = args.at(-1);
      fs.mkdirSync(destination, { recursive: true });
      fs.writeFileSync(path.join(destination, 'package.json'), '{}');
      fs.writeFileSync(path.join(destination, 'package-lock.json'), '{"lockfileVersion":3}');
      return { stdout: '', stderr: '' };
    }
    if (args[0] === 'ci') {
      fs.mkdirSync(path.join(options.cwd, 'node_modules', 'playwright'), { recursive: true });
      fs.writeFileSync(path.join(options.cwd, 'node_modules', 'playwright', 'cli.js'), '');
      return { stdout: '', stderr: '' };
    }
    if (args.includes('rev-parse')) return { stdout: 'abc123\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  // Es la ruta real donde queda npm tras RunQA Setup: sin comillas, cmd.exe
  // corta en el espacio de "Program Files".
  const npmPath = 'C:\\Program Files\\nodejs\\npm.cmd';
  await createProjectManager({ projectsDir, run, npmPath }).importExisting({ id: 'local', sourcePath });
  const npmCall = calls.find((call) => call.args[0] === 'ci');
  assert.equal(npmCall.command, `"${npmPath}"`);
  assert.equal(npmCall.options.shell, true);
});

test('un ejecutable de verdad no se invoca con shell', async () => {
  const projectsDir = temp();
  const sourcePath = temp();
  fs.mkdirSync(path.join(sourcePath, '.git'));
  const calls = [];
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, options });
    if (args.includes('remote') && args.includes('get-url')) return { stdout: 'https://example.test/qa.git\n', stderr: '' };
    if (args.includes('ls-remote')) return { stdout: 'ref: refs/heads/main\tHEAD\nabc\tHEAD\n', stderr: '' };
    if (args.includes('clone')) {
      const destination = args.at(-1);
      fs.mkdirSync(destination, { recursive: true });
      fs.writeFileSync(path.join(destination, 'package.json'), '{}');
      fs.writeFileSync(path.join(destination, 'package-lock.json'), '{"lockfileVersion":3}');
      return { stdout: '', stderr: '' };
    }
    if (args[0] === 'ci') {
      fs.mkdirSync(path.join(options.cwd, 'node_modules', 'playwright'), { recursive: true });
      fs.writeFileSync(path.join(options.cwd, 'node_modules', 'playwright', 'cli.js'), '');
      return { stdout: '', stderr: '' };
    }
    if (args.includes('rev-parse')) return { stdout: 'abc123\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  await createProjectManager({ projectsDir, run, npmPath: 'npm' }).importExisting({ id: 'local', sourcePath });
  // Buscar por comando exacto no sirve: en Windows `resolveCommand` devuelve la
  // ruta absoluta ("C:\Program Files\Git\cmd\git.exe"), así que `find('git')` da
  // undefined y el test se cae por una razón que no es la que mide.
  assert.ok(calls.length > 0, 'se esperaba al menos una invocación');
  assert.deepEqual(calls.filter((call) => call.options.shell === true), []);
});

test('remove borra el clon dentro de la carpeta administrada', () => {
  const projectsDir = temp();
  const repoPath = path.join(projectsDir, 'erp');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'package.json'), '{}');
  createProjectManager({ projectsDir, run: async () => ({ stdout: '', stderr: '' }) })
    .remove({ repoPath, repoUrl: 'x', defaultBranch: 'main' });
  assert.equal(fs.existsSync(repoPath), false);
});

test('remove rechaza una ruta fuera de la carpeta administrada', () => {
  const projectsDir = temp();
  const outside = path.join(projectsDir, '..', 'personal');
  assert.throws(
    () => createProjectManager({ projectsDir, run: async () => ({ stdout: '', stderr: '' }) })
      .remove({ repoPath: outside, repoUrl: 'x', defaultBranch: 'main' }),
    (err) => err.code === 'UNMANAGED_REPOSITORY',
  );
});

test('remove sin repoPath lanza PROJECT_NOT_INITIALIZED', () => {
  const projectsDir = temp();
  assert.throws(
    () => createProjectManager({ projectsDir, run: async () => ({ stdout: '', stderr: '' }) }).remove({}),
    (err) => err.code === 'PROJECT_NOT_INITIALIZED',
  );
});

/** Deja en disco un repo ya clonado, con Playwright instalado, listo para `prepare`. */
function repoYaClonado(projectsDir, version) {
  const repoPath = path.join(projectsDir, 'erp');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'node_modules', 'playwright'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'node_modules', 'playwright', 'cli.js'), '');
  fs.mkdirSync(path.join(repoPath, 'node_modules', 'playwright-core'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'node_modules', 'playwright-core', 'package.json'), `{"version":"${version}"}`);
  fs.writeFileSync(path.join(repoPath, 'package-lock.json'), '{"lockfileVersion":3}');
  const dependencyLockHash = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(repoPath, 'package-lock.json'))).digest('hex');
  return { repoPath, dependencyLockHash };
}

const gitFalso = async (command, args) => {
  if (args[0] === 'ls-remote') return { stdout: 'ref: refs/heads/main\tHEAD\nabc\tHEAD\n', stderr: '' };
  if (args[0] === 'remote') return { stdout: 'https://example.test/qa.git\n', stderr: '' };
  if (args[0] === 'rev-parse') return { stdout: 'abc123\n', stderr: '' };
  return { stdout: '', stderr: '' };
};

/**
 * Corre con una caché de navegadores de mentira, para no depender del perfil real.
 *
 * `LOCALAPPDATA` sola no alcanza: `browsers.js` sólo la mira en `win32`, así que
 * en el Linux de desarrollo estos tests leían el `~/.cache/ms-playwright` de
 * verdad y pasaban o fallaban según lo que tuviera puesto la máquina.
 * `PLAYWRIGHT_BROWSERS_PATH` manda en las tres plataformas, que es lo que hace
 * al fixture independiente del sistema operativo. `LOCALAPPDATA` se sigue
 * moviendo porque los tests escriben el marcador con esa ruta.
 */
async function conPerfil(navegadores, accion) {
  const previo = { local: process.env.LOCALAPPDATA, browsers: process.env.PLAYWRIGHT_BROWSERS_PATH };
  const perfil = temp();
  const cache = path.join(perfil, 'ms-playwright');
  fs.mkdirSync(cache, { recursive: true });
  for (const nombre of navegadores) fs.mkdirSync(path.join(cache, nombre), { recursive: true });
  process.env.LOCALAPPDATA = perfil;
  process.env.PLAYWRIGHT_BROWSERS_PATH = cache;
  try { return await accion(); }
  finally {
    for (const [clave, valor] of [['LOCALAPPDATA', previo.local], ['PLAYWRIGHT_BROWSERS_PATH', previo.browsers]]) {
      if (valor === undefined) delete process.env[clave];
      else process.env[clave] = valor;
    }
  }
}

test('avisa cuando los navegadores instalados no sirven para el proyecto', async () => {
  const projectsDir = temp();
  const { repoPath, dependencyLockHash } = repoYaClonado(projectsDir, '1.49.0');

  await conPerfil(['chromium-1208'], async () => {
    fs.writeFileSync(
      path.join(process.env.LOCALAPPDATA, 'ms-playwright', '.runqa-setup.json'),
      '{"playwrightVersion":"1.58.2"}',
    );
    const manager = createProjectManager({ projectsDir, run: gitFalso });
    await assert.rejects(
      () => manager.prepare({ repoPath, repoUrl: 'https://example.test/qa.git', defaultBranch: 'main', dependencyLockHash }),
      (err) => err.code === 'BROWSERS_VERSION_MISMATCH',
    );
  });
});

/**
 * El caso que rompió un equipo en producción: los navegadores estaban, pero el
 * marcador no (el Setup nunca llegó a ese paso). El proyecto ya clonado dejó de
 * abrir. Sin marcador no hay versión que comparar, y eso no es motivo para
 * bloquear.
 */
test('un proyecto ya clonado abre con los navegadores puestos aunque falte el marcador', async () => {
  const projectsDir = temp();
  const { repoPath, dependencyLockHash } = repoYaClonado(projectsDir, '1.49.0');

  await conPerfil(['chromium-1208', 'firefox-1489', 'webkit-2140'], async () => {
    const manager = createProjectManager({ projectsDir, run: gitFalso });
    const proyecto = await manager.prepare({ repoPath, repoUrl: 'https://example.test/qa.git', defaultBranch: 'main', dependencyLockHash });
    assert.equal(proyecto.commit, 'abc123');
  });
});

test('sin ningún navegador en el perfil dice que faltan, no que están desalineados', async () => {
  const projectsDir = temp();
  const { repoPath, dependencyLockHash } = repoYaClonado(projectsDir, '1.49.0');

  await conPerfil([], async () => {
    const manager = createProjectManager({ projectsDir, run: gitFalso });
    await assert.rejects(
      () => manager.prepare({ repoPath, repoUrl: 'https://example.test/qa.git', defaultBranch: 'main', dependencyLockHash }),
      (err) => err.code === 'BROWSERS_NOT_INSTALLED' && /cuenta/i.test(err.message),
    );
  });
});

test('la carpeta de proyectos puede cambiar sin reiniciar la app', () => {
  const primera = temp();
  const segunda = temp();
  let raiz = primera;
  const manager = createProjectManager({ projectsDir: () => raiz, run: async () => ({ stdout: '', stderr: '' }) });
  raiz = segunda;
  const repoPath = path.join(segunda, 'erp');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  manager.remove({ repoPath, repoUrl: 'x', defaultBranch: 'main' });
  assert.equal(fs.existsSync(repoPath), false);
});

test('un proyecto de la carpeta anterior se sigue administrando tras mudar la raíz', () => {
  // Cambiar de carpeta no mueve lo ya clonado. Si sólo se mirara la raíz nueva,
  // el proyecto viejo quedaría sin poder actualizarse ni borrarse.
  const vieja = temp();
  const nueva = temp();
  const repoPath = path.join(vieja, 'erp');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  createProjectManager({
    projectsDir: () => nueva,
    managedRoots: () => [nueva, vieja],
    run: async () => ({ stdout: '', stderr: '' }),
  }).remove({ repoPath, repoUrl: 'x', defaultBranch: 'main' });
  assert.equal(fs.existsSync(repoPath), false);
});

test('una carpeta ajena sigue estando fuera de alcance aunque haya varias raíces', () => {
  const raiz = temp();
  const ajena = temp();
  const repoPath = path.join(ajena, 'erp');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  assert.throws(
    () => createProjectManager({ projectsDir: raiz, managedRoots: () => [raiz], run: async () => ({ stdout: '', stderr: '' }) })
      .remove({ repoPath, repoUrl: 'x', defaultBranch: 'main' }),
    /UNMANAGED_REPOSITORY|no está administrada/,
  );
  assert.equal(fs.existsSync(repoPath), true);
});
